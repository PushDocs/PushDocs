// @vitest-environment jsdom

import {
  BranchConflictChoice,
  BranchUpdateStrategy,
  branchConflictLimits,
} from "@pushdocs/contracts";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../../tests/fixtures/branch-update-policy";

const mocks = vi.hoisted(() => ({
  prepare: vi.fn(),
  inspect: vi.fn(),
  status: vi.fn(),
  submit: vi.fn(),
  retry: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  router: { refresh: vi.fn(), push: vi.fn(), replace: vi.fn() },
}));
vi.mock("@/app/actions", () => ({
  gitOperationStatusAction: mocks.status,
  startGitOperationAction: mocks.start,
}));
vi.mock("@/app/conflict-actions", () => ({
  prepareConflictResolutionAction: mocks.prepare,
  inspectReviewConflictsAction: mocks.inspect,
  submitConflictResolutionAction: mocks.submit,
  retryConflictResolutionAction: mocks.retry,
  cancelRebaseUpdateAction: mocks.cancel,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import {
  BranchConflictNotice,
  BranchConflictResolver,
  DocumentBranchConflicts,
  ProjectConflictProgress,
  ReviewConflictFiles,
} from "./branch-conflicts";
import { conflictInspectionStore } from "./conflict-inspection";
import { clearDraft, draftKey, writeDraft } from "./draft-storage";

const snapshot = {
  updatePolicy: resolvedBranchUpdatePolicy(),
  branch: "docs/task",
  sourceBranch: "stable",
  parentSha: "parent",
  sourceSha: "target",
  files: [
    {
      path: "docs/a.md",
      kind: "text",
      baseContent: "Base",
      oursContent: "Ours",
      theirsContent: "Theirs",
      sections: [{ kind: "conflict", base: "Base", ours: "Ours", theirs: "Theirs" }],
      oursExists: true,
      theirsExists: true,
    },
  ],
};
const props = {
  projectId: "project",
  reviewId: "review",
  branch: "docs/task",
  targetBranch: "stable",
  defaultBranch: "main",
  ownerId: "user",
  canWrite: true,
  providerUrl: "https://git.example/review",
  reviewLabel: "MR",
};
beforeEach(() => {
  conflictInspectionStore.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.clearAllMocks();
  mocks.prepare.mockResolvedValue([{ branch: "docs/task", paths: [], busy: false }]);
  mocks.inspect.mockResolvedValue("inspect");
  mocks.status.mockImplementation(async (_project, id) =>
    id === "inspect" ? { status: "done", conflictSnapshot: snapshot } : { status: "done" },
  );
  mocks.submit.mockResolvedValue("publish");
});
afterEach(() => {
  cleanup();
  conflictInspectionStore.clear();
  vi.useRealTimers();
});

it("returns to the existing branch update notice instead of showing uneditable rebase previews", async () => {
  mocks.status.mockResolvedValue({
    status: "done",
    conflictSnapshot: {
      ...snapshot,
      updatePolicy: resolvedBranchUpdatePolicy({ strategy: BranchUpdateStrategy.Rebase }),
    },
  });
  render(<BranchConflictResolver {...props} />);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/projects/project/changes?branch=docs%2Ftask",
    ),
  );
  expect(screen.queryByText(/Для проекта выбран rebase/)).toBeNull();
  expect(screen.queryByRole("button", { name: "Отправить исправления в docs/task" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Начать rebase" })).toBeNull();
  expect(screen.queryByRole("heading", { name: "docs/a.md" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

const rebaseSnapshot = (index: number) => ({
  ...snapshot,
  updatePolicy: resolvedBranchUpdatePolicy({ strategy: BranchUpdateStrategy.Rebase }),
  rebase: {
    operationId: "rebase",
    conflictId: `conflict-${index}`,
    commitSha: `commit-${index}`,
    currentParentSha: `rebased-${index}`,
    originalParentSha: `original-${index}`,
    index,
    total: 2,
    title: `Edit ${index}`,
  },
});

it("resolves consecutive commits, shows progress between them and returns to changes when rebase is done", async () => {
  let step = 1;
  let finishNextCommit: ((job: unknown) => void) | undefined;
  mocks.prepare.mockResolvedValue([
    { branch: "docs/task", paths: [], busy: true, mergeJobId: "rebase" },
  ]);
  mocks.status.mockImplementation(async (_project, id) =>
    id === "inspect"
      ? {
          status: "done",
          conflictSnapshot: {
            ...snapshot,
            updatePolicy: resolvedBranchUpdatePolicy({ strategy: BranchUpdateStrategy.Rebase }),
          },
        }
      : step === 2
        ? new Promise((resolve) => (finishNextCommit = resolve))
        : step < 3
          ? { status: "needs_resolution", conflictSnapshot: rebaseSnapshot(step) }
          : { status: "done" },
  );
  mocks.submit.mockImplementation(async () => {
    step++;
    return "rebase";
  });
  render(<BranchConflictResolver {...props} />);
  expect(await screen.findByText(/Edit 1/)).toBeTruthy();
  expect(screen.getByText("docs/task").closest("p")?.textContent).toBe(
    "docs/task ← stable (rebase)",
  );
  expect(screen.queryByText(/SHA/)).toBeNull();
  expect(screen.queryByText(/Для проекта выбран rebase/)).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("radio", { name: "Оставить актуальную основу" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  expect(await screen.findByText("Обновляем ветку из stable…")).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "docs/a.md" })).toBeNull();
  await waitFor(() => expect(finishNextCommit).toBeTypeOf("function"));
  await act(async () =>
    finishNextCommit?.({ status: "needs_resolution", conflictSnapshot: rebaseSnapshot(2) }),
  );
  expect(await screen.findByText(/Edit 2/)).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Сохранить и продолжить" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByRole("radio", { name: "Оставить актуальную основу" }) as HTMLInputElement).checked,
  ).toBe(false);
  fireEvent.click(screen.getByRole("radio", { name: "Применить изменения коммита" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить и продолжить" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(2));
  expect(mocks.submit).toHaveBeenNthCalledWith(
    1,
    "project",
    "rebase",
    [{ path: "docs/a.md", choice: BranchConflictChoice.Manual, content: "Ours" }],
    "conflict-1",
  );
  expect(mocks.submit).toHaveBeenNthCalledWith(
    2,
    "project",
    "rebase",
    [{ path: "docs/a.md", choice: BranchConflictChoice.Manual, content: "Theirs" }],
    "conflict-2",
  );
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/projects/project/changes?branch=docs%2Ftask",
    ),
  );
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText(/Результат отправлен/)).toBeNull();
});

it("reopens the current paused commit after reload and cancels that exact conflict", async () => {
  mocks.prepare.mockResolvedValue([
    { branch: "docs/task", paths: [], busy: true, mergeJobId: "rebase" },
  ]);
  mocks.status.mockResolvedValue({
    status: "needs_resolution",
    conflictSnapshot: rebaseSnapshot(2),
  });
  render(<BranchConflictResolver {...props} />);
  expect(await screen.findByText(/Edit 2/)).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отменить rebase" }));
  await waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("project", "rebase", "conflict-2"));
  expect(mocks.router.push).toHaveBeenCalledWith("/projects/project/changes?branch=docs%2Ftask");
});

it("keeps conflicts visible in documents after the background inspection finishes", async () => {
  render(
    <>
      <ProjectConflictProgress projectId="project" ownerId="user" hidden />
      <DocumentBranchConflicts {...props} canInspect hasPendingChanges={false} />
    </>,
  );
  const notice = screen.getByRole("region", { name: "Конфликты между ветками" });
  expect(await within(notice).findByText("docs/a.md")).toBeTruthy();
  expect(within(notice).getByText("Исправьте конфликты")).toBeTruthy();
  expect(
    within(notice).getByRole("link", { name: "Исправить конфликты" }).getAttribute("href"),
  ).toBe("/projects/project/changes?branch=docs%2Ftask&resolve=review");
  expect(screen.queryByRole("complementary", { name: "Фоновые проверки конфликтов" })).toBeNull();
});

it("shows loading and a retryable error inside documents while keeping the resolution action", async () => {
  let fail: ((error: Error) => void) | undefined;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        fail = reject;
      }),
  );
  render(
    <>
      <ProjectConflictProgress projectId="project" ownerId="user" hidden />
      <DocumentBranchConflicts {...props} canInspect hasPendingChanges={false} />
    </>,
  );
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.getByRole("status").querySelector("svg.spin")).toBeTruthy();
  await act(async () => fail?.(new Error("GitLab is not responding")));
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.getByRole("alert").textContent).toContain("GitLab is not responding");
  expect(screen.getByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
  expect(await screen.findByText("docs/a.md")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("only shows conflicts for the selected documents branch", async () => {
  const view = render(<DocumentBranchConflicts {...props} canInspect hasPendingChanges={false} />);
  await screen.findByText("docs/a.md");
  mocks.inspect.mockReturnValueOnce(new Promise(() => {}));
  view.rerender(
    <DocumentBranchConflicts
      {...props}
      branch="docs/other"
      reviewId="other-review"
      canInspect
      hasPendingChanges={false}
    />,
  );
  expect(screen.queryByText("docs/a.md")).toBeNull();
  expect(screen.getByRole("status")).toBeTruthy();
  expect(mocks.inspect).toHaveBeenLastCalledWith("project", "other-review", false);
});

it("lets readers inspect conflicts and directs fork conflicts to the provider", async () => {
  const view = render(
    <DocumentBranchConflicts {...props} canWrite={false} canInspect hasPendingChanges={false} />,
  );
  await screen.findByText("docs/a.md");
  expect(screen.queryByRole("link", { name: "Исправить конфликты" })).toBeNull();
  expect(screen.getByRole("link", { name: "Открыть MR" })).toBeTruthy();
  view.unmount();
  mocks.inspect.mockClear();
  render(
    <DocumentBranchConflicts
      {...props}
      canWrite={false}
      canInspect={false}
      hasPendingChanges={false}
    />,
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(screen.queryByText("docs/a.md")).toBeNull();
  expect(screen.getByRole("link", { name: "Открыть MR" })).toBeTruthy();
});

it("shows actual conflict paths directly in review details", async () => {
  render(<ReviewConflictFiles projectId="project" reviewId="review" />);
  expect(await screen.findByText("docs/a.md")).toBeTruthy();
  expect(screen.getByText("Конфликтующие файлы: 1")).toBeTruthy();
});

it("keeps conflict paths visible and spins the refresh button until the updated list arrives", async () => {
  mocks.status.mockResolvedValue({
    status: "done",
    conflictSnapshot: { ...snapshot, mediaContentsSkipped: true },
  });
  render(<ReviewConflictFiles {...props} />);
  await screen.findByText("docs/a.md");
  expect(screen.queryByText(/Медиа проверены по версиям файлов/)).toBeNull();
  let finish: ((jobId: string) => void) | undefined;
  mocks.inspect.mockImplementationOnce(
    () =>
      new Promise<string>((resolve) => {
        finish = resolve;
      }),
  );
  const refresh = screen.getByRole("button", { name: "Обновить список конфликтов" });
  fireEvent.click(refresh);
  expect(screen.getByText("docs/a.md")).toBeTruthy();
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(refresh.getAttribute("aria-busy")).toBe("true");
  expect(refresh.querySelector("svg.spin")).toBeTruthy();
  mocks.status.mockResolvedValue({
    status: "done",
    conflictSnapshot: {
      ...snapshot,
      files: [{ ...snapshot.files[0], path: "docs/updated.md" }],
    },
  });
  await act(async () => finish?.("refreshed"));
  expect(await screen.findByText("docs/updated.md")).toBeTruthy();
  expect(screen.queryByText("docs/a.md")).toBeNull();
  expect((refresh as HTMLButtonElement).disabled).toBe(false);
  expect(refresh.querySelector("svg.spin")).toBeNull();
});

it("keeps the current list after a refresh fails and allows another refresh", async () => {
  render(<ReviewConflictFiles {...props} />);
  await screen.findByText("docs/a.md");
  mocks.inspect.mockRejectedValueOnce(new Error("Не удалось обновить конфликты"));
  const refresh = screen.getByRole("button", { name: "Обновить список конфликтов" });
  fireEvent.click(refresh);
  expect((await screen.findByRole("alert")).textContent).toBe("Не удалось обновить конфликты");
  expect(screen.getByText("docs/a.md")).toBeTruthy();
  expect((refresh as HTMLButtonElement).disabled).toBe(false);
  expect(refresh.querySelector("svg.spin")).toBeNull();
  fireEvent.click(refresh);
  await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  expect(screen.getByText("docs/a.md")).toBeTruthy();
});

it("shows a refresh spinner in the resolver without removing its existing file", async () => {
  mocks.status.mockResolvedValueOnce({
    status: "done",
    conflictSnapshot: {
      ...snapshot,
      files: [{ ...snapshot.files[0], sections: undefined }],
    },
  });
  render(<BranchConflictResolver {...props} />);
  const refresh = await screen.findByRole("button", { name: "Обновить список конфликтов" });
  mocks.inspect.mockReturnValueOnce(new Promise(() => {}));
  fireEvent.click(refresh);
  expect(screen.getByRole("heading", { name: "docs/a.md" })).toBeTruthy();
  expect((refresh as HTMLButtonElement).disabled).toBe(true);
  expect(refresh.querySelector("svg.spin")).toBeTruthy();
});

it("keeps resolution choices visible and blocks submission while their inspection refreshes", async () => {
  render(
    <>
      <ReviewConflictFiles {...props} />
      <BranchConflictResolver {...props} />
    </>,
  );
  const choice = await screen.findByLabelText("Оставить ваш текст");
  fireEvent.click(choice);
  const submit = screen.getByRole("button", { name: "Отправить исправления в docs/task" });
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  mocks.inspect.mockReturnValueOnce(new Promise(() => {}));
  fireEvent.click(screen.getByRole("button", { name: "Обновить список конфликтов" }));
  expect((choice as HTMLInputElement).checked).toBe(true);
  expect(choice.closest("fieldset.branch-conflict-files")?.hasAttribute("disabled")).toBe(true);
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(submit);
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("shows a visible animated indicator while conflict files are loading", () => {
  mocks.inspect.mockReturnValue(new Promise(() => {}));
  render(
    <>
      <ProjectConflictProgress projectId="project" ownerId="user" />
      <ReviewConflictFiles projectId="project" reviewId="review" />
    </>,
  );
  const loader = screen.getByRole("status");
  expect(loader.textContent).toContain("Определяем конфликтующие файлы…");
  expect(loader.querySelector("svg.spin")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("shows a single project loader with downloaded MB in parentheses on the resolver page", async () => {
  mocks.status.mockResolvedValue({
    status: "running",
    progress: "comparing-conflicts",
    transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
  });
  render(
    <>
      <ProjectConflictProgress projectId="project" ownerId="user" />
      <BranchConflictResolver {...props} />
    </>,
  );
  expect(
    await screen.findByText("Определяем конфликтующие файлы… (загружено 12,5 МБ)"),
  ).toBeTruthy();
  expect(screen.getAllByRole("status")).toHaveLength(1);
  expect(screen.queryByRole("progressbar")).toBeNull();
});

it("returns to ordinary changes automatically when the current branch has drafts", async () => {
  sessionStorage.setItem("pushdocs:branch:project", "other");
  mocks.prepare.mockResolvedValue([
    { branch: "docs/task", paths: [], busy: false },
    { branch: "other", paths: ["draft.md"], busy: false },
  ]);
  render(<BranchConflictResolver {...props} />);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/projects/project/changes?branch=other&conflict=review",
    ),
  );
  expect(sessionStorage.getItem("pushdocs:branch:project")).toBe("other");
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(screen.queryByText("Подготовка к разрешению конфликтов")).toBeNull();
});

it("offers conflict resolution only after the current saved changes are cleared", () => {
  const view = render(
    <BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges />,
  );
  expect(screen.getByRole("heading", { name: "Сохраните текущие правки" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Исправить конфликты" })).toBeNull();
  view.rerender(
    <BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={false} />,
  );
  expect(screen.getByRole("heading", { name: "Исправьте конфликты" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
});

it("returns browser-only drafts to the normal changes view and explains them in the notice", async () => {
  const key = draftKey("project", "docs/task", "local.md", "user");
  writeDraft(key, "Unsaved", "Base");
  const view = render(<BranchConflictResolver {...props} />);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/projects/project/changes?branch=docs%2Ftask&conflict=review",
    ),
  );
  expect(mocks.inspect).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toContain("Unsaved");
  view.unmount();
  render(<BranchConflictNotice {...props} currentBranch="docs/task" hasPendingChanges={false} />);
  expect(await screen.findByText(/Сохраните текущие правки/)).toBeTruthy();
  expect(screen.getByRole("link", { name: "Открыть правки" })).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Исправить конфликты" })).toBeNull();
  clearDraft(key);
  fireEvent.focus(window);
  expect(screen.getByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
  expect(screen.queryByText(/Сохраните текущие правки/)).toBeNull();
});

it("requires a decision and sends the chosen branch version to the existing review branch", async () => {
  render(<BranchConflictResolver {...props} />);
  const submit = await screen.findByRole("button", { name: "Отправить исправления в docs/task" });
  expect((submit as HTMLButtonElement).disabled).toBe(true);
  expect(screen.queryByRole("button", { name: "Проверить состояние и продолжить" })).toBeNull();
  fireEvent.click(screen.getByLabelText("Откатить до stable"));
  expect((submit as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(submit);
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith("project", "inspect", [
      { path: "docs/a.md", choice: BranchConflictChoice.Manual, content: "Theirs" },
    ]),
  );
  expect(await screen.findByText("Решение отправлено в docs/task")).toBeTruthy();
});

it("explains which text is in the full document and marks the rejected alternative after selection", async () => {
  render(<BranchConflictResolver {...props} />);
  await screen.findByLabelText("Откатить до stable");
  const document = window.document.querySelector(".conflict-document-preview");
  expect(document?.textContent).toContain("Предварительный результат");
  expect(document?.textContent).toContain("нерешённых фрагментах (1)");
  expect(document?.querySelector(".conflict-document-source")?.textContent).toContain("Ours");
  expect(document?.querySelector(".conflict-document-source")?.textContent).not.toContain("Theirs");
  fireEvent.click(screen.getByLabelText("Откатить до stable"));
  expect(
    window.document
      .querySelector('.conflict-diff-changes [data-kind="delete"]')
      ?.getAttribute("data-discarded"),
  ).toBe("true");
  expect(
    window.document
      .querySelector('.conflict-diff-changes [data-kind="add"]')
      ?.getAttribute("data-discarded"),
  ).toBe("false");
  expect(document?.textContent).toContain("Итоговый документ");
  expect(document?.textContent).toContain("Все выбранные решения применены");
  expect(document?.querySelector(".conflict-document-source")?.textContent).toContain("Theirs");
  expect(document?.querySelector(".conflict-document-source")?.textContent).not.toContain("Ours");
  fireEvent.click(screen.getByLabelText("Оставить ваш текст"));
  expect(
    window.document
      .querySelector('.conflict-diff-changes [data-kind="add"]')
      ?.getAttribute("data-discarded"),
  ).toBe("true");
  expect(
    window.document
      .querySelector('.conflict-diff-changes [data-kind="delete"]')
      ?.getAttribute("data-discarded"),
  ).toBe("false");
});

it("keeps a manual result across remount and blocks unsupported conflicts", async () => {
  const view = render(<BranchConflictResolver {...props} />);
  fireEvent.click(await screen.findByLabelText("Свой текст"));
  expect(screen.queryByText("Итоговый текст фрагмента 1")).toBeNull();
  fireEvent.change(screen.getByLabelText("Свой текст: docs/a.md, фрагмент 1"), {
    target: { value: "Combined" },
  });
  expect(screen.getByRole("region", { name: "Свой вариант в сравнении" }).textContent).toContain(
    "Combined",
  );
  expect(
    window.document.querySelectorAll('.conflict-diff-block[data-discarded="true"]'),
  ).toHaveLength(2);
  view.unmount();
  render(<BranchConflictResolver {...props} />);
  expect(
    ((await screen.findByLabelText("Свой текст: docs/a.md, фрагмент 1")) as HTMLTextAreaElement)
      .value,
  ).toBe("Combined");
  cleanup();
  conflictInspectionStore.clear();
  mocks.status.mockResolvedValue({
    status: "done",
    conflictSnapshot: {
      ...snapshot,
      unsupportedReason: "Rename conflict",
      files: [{ ...snapshot.files[0], kind: "unsupported" }],
    },
  });
  render(<BranchConflictResolver {...props} />);
  expect(await screen.findByText("Rename conflict")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Отправить исправления в docs/task" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("collapses rejected rows, allows reading them, and keeps the custom text inline without a heading", async () => {
  render(<BranchConflictResolver {...props} />);
  fireEvent.click(await screen.findByLabelText("Откатить до stable"));
  const rejected = window.document.querySelector<HTMLDetailsElement>(
    '.conflict-diff-block[data-kind="delete"]',
  );
  expect(rejected?.tagName).toBe("DETAILS");
  expect(rejected?.open).toBe(false);
  const summary = rejected?.querySelector("summary");
  if (!summary) throw new Error("Missing rejected variant disclosure");
  fireEvent.click(summary);
  expect(rejected?.open).toBe(true);
  expect(rejected?.querySelector(".conflict-diff-discarded-content")?.textContent).toContain(
    "Ours",
  );
  fireEvent.click(screen.getByLabelText("Свой текст"));
  const disclosures = [
    ...window.document.querySelectorAll<HTMLDetailsElement>(
      '.conflict-diff-block[data-discarded="true"]',
    ),
  ];
  expect(disclosures).toHaveLength(2);
  expect(disclosures.every((details) => !details.open)).toBe(true);
  const firstSummary = disclosures[0]?.querySelector("summary");
  if (!firstSummary) throw new Error("Missing custom variant disclosure");
  fireEvent.click(firstSummary);
  fireEvent.change(screen.getByLabelText("Свой текст: docs/a.md, фрагмент 1"), {
    target: { value: "Custom result" },
  });
  expect(disclosures[0]?.open).toBe(true);
  const custom = screen.getByRole("region", { name: "Свой вариант в сравнении" });
  expect(custom.textContent).toBe(" Custom result");
  expect(custom.querySelector("h4")).toBeNull();
});

it("clears a selected option on a second click and restores a custom draft without marking it resolved", async () => {
  const view = render(<BranchConflictResolver {...props} />);
  const ours = await screen.findByLabelText("Оставить ваш текст");
  const submit = screen.getByRole("button", {
    name: "Отправить исправления в docs/task",
  }) as HTMLButtonElement;
  fireEvent.click(ours);
  expect((ours as HTMLInputElement).checked).toBe(true);
  fireEvent.click(ours);
  expect((ours as HTMLInputElement).checked).toBe(false);
  expect(screen.getByText("Осталось выбрать: 1 из 1")).toBeTruthy();
  expect(submit.disabled).toBe(true);
  expect(window.document.querySelectorAll("details.conflict-diff-block")).toHaveLength(0);
  fireEvent.click(screen.getByLabelText("Свой текст"));
  fireEvent.change(screen.getByLabelText("Свой текст: docs/a.md, фрагмент 1"), {
    target: { value: "Saved custom draft" },
  });
  fireEvent.click(screen.getByLabelText("Свой текст"));
  expect((screen.getByLabelText("Свой текст") as HTMLInputElement).checked).toBe(false);
  expect(submit.disabled).toBe(true);
  expect(window.document.querySelector(".conflict-diff-manual")).toBeNull();
  expect(window.document.querySelector(".conflict-document-source")?.textContent).toContain("Ours");
  expect(window.document.querySelector(".conflict-document-source")?.textContent).not.toContain(
    "Saved custom draft",
  );
  view.unmount();
  render(<BranchConflictResolver {...props} />);
  const manual = await screen.findByLabelText("Свой текст");
  expect((manual as HTMLInputElement).checked).toBe(false);
  fireEvent.click(manual);
  expect(
    (screen.getByLabelText("Свой текст: docs/a.md, фрагмент 1") as HTMLTextAreaElement).value,
  ).toBe("Saved custom draft");
});

it("keeps unfinished fragment decisions across remount and submits mixed choices with all automatic edits", async () => {
  mocks.status.mockImplementation(async (_project, id) =>
    id === "inspect"
      ? {
          status: "done",
          conflictSnapshot: {
            ...snapshot,
            files: [
              {
                ...snapshot.files[0],
                sections: [
                  { kind: "text", content: "Automatic intro\n" },
                  {
                    kind: "conflict",
                    base: "First\n",
                    ours: "Our first\n",
                    theirs: "Their first\n",
                  },
                  { kind: "text", content: "Shared middle\n" },
                  {
                    kind: "conflict",
                    base: "Second\n",
                    ours: "Our second\n",
                    theirs: "Their second\n",
                  },
                  { kind: "text", content: "Automatic footer\n" },
                ],
              },
            ],
          },
        }
      : { status: "done" },
  );
  const view = render(<BranchConflictResolver {...props} />);
  const first = await screen.findByRole("group", { name: "Фрагмент 1 из 2 · Выберите текст" });
  fireEvent.click(within(first).getByLabelText("Оставить ваш текст"));
  expect(screen.getByText("Осталось выбрать: 1 из 2")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Отправить исправления в docs/task" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  view.unmount();
  render(<BranchConflictResolver {...props} />);
  expect(
    ((await screen.findAllByLabelText("Оставить ваш текст"))[0] as HTMLInputElement).checked,
  ).toBe(true);
  const second = screen.getByRole("group", { name: "Фрагмент 2 из 2 · Выберите текст" });
  fireEvent.click(within(second).getByLabelText("Откатить до stable"));
  expect(screen.getByText("Все фрагменты решены")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith("project", "inspect", [
      {
        path: "docs/a.md",
        choice: BranchConflictChoice.Manual,
        content: "Automatic intro\nOur first\nShared middle\nTheir second\nAutomatic footer\n",
      },
    ]),
  );
});

it("preserves an older whole-document manual draft without interpreting it as fragment choices", async () => {
  localStorage.setItem(
    'pushdocs:merge-resolution:["user","project","review"]',
    JSON.stringify({
      parentSha: "parent",
      sourceSha: "target",
      choices: {
        "docs/a.md": {
          path: "docs/a.md",
          choice: BranchConflictChoice.Manual,
          content: "Previously saved document",
        },
      },
    }),
  );
  render(<BranchConflictResolver {...props} />);
  expect(await screen.findByText(/Сохранено решение для всего документа/)).toBeTruthy();
  expect((screen.getByLabelText("Оставить ваш текст") as HTMLInputElement).checked).toBe(false);
  expect((screen.getByLabelText("Итог docs/a.md") as HTMLTextAreaElement).value).toBe(
    "Previously saved document",
  );
  fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith("project", "inspect", [
      {
        path: "docs/a.md",
        choice: BranchConflictChoice.Manual,
        content: "Previously saved document",
      },
    ]),
  );
});

it("keeps deletion as an explicit document decision", async () => {
  mocks.status.mockResolvedValue({
    status: "done",
    conflictSnapshot: {
      ...snapshot,
      files: [{ ...snapshot.files[0], oursExists: false, oursContent: null, sections: undefined }],
    },
  });
  render(<BranchConflictResolver {...props} />);
  fireEvent.click(await screen.findByLabelText("Удалить документ, как в docs/task"));
  fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  await waitFor(() =>
    expect(mocks.submit).toHaveBeenCalledWith("project", "inspect", [
      { path: "docs/a.md", choice: BranchConflictChoice.Ours },
    ]),
  );
});

it("discards fragment choices when the inspected branch versions change", async () => {
  localStorage.setItem(
    'pushdocs:merge-resolution:["user","project","review"]',
    JSON.stringify({
      parentSha: "previous",
      sourceSha: "target",
      fragmentDraftVersion: 1,
      choices: {
        "docs/a.md": { path: "docs/a.md", choice: BranchConflictChoice.Manual, content: "Stale" },
      },
      fragments: { "docs/a.md": { 0: { choice: BranchConflictChoice.Ours } } },
    }),
  );
  render(<BranchConflictResolver {...props} />);
  await screen.findByText("Осталось выбрать: 1 из 1");
  expect((screen.getByLabelText("Оставить ваш текст") as HTMLInputElement).checked).toBe(false);
  expect(
    (screen.getByRole("button", { name: "Отправить исправления в docs/task" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
});

it("allows retrying a failed branch check without starting an inspection prematurely", async () => {
  mocks.prepare.mockRejectedValueOnce(new Error("Branch state is unavailable"));
  render(<BranchConflictResolver {...props} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Branch state is unavailable");
  expect(mocks.inspect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Повторить проверку" }));
  expect(await screen.findByLabelText("Оставить ваш текст")).toBeTruthy();
  expect(screen.queryByRole("alert")).toBeNull();
});

it("keeps decisions after a submission error and lets the user send them again", async () => {
  mocks.submit.mockRejectedValueOnce(new Error("Submission unavailable"));
  render(<BranchConflictResolver {...props} />);
  fireEvent.click(await screen.findByLabelText("Оставить ваш текст"));
  const submit = screen.getByRole("button", { name: "Отправить исправления в docs/task" });
  fireEvent.click(submit);
  expect((await screen.findByRole("alert")).textContent).toBe("Submission unavailable");
  expect(screen.getByLabelText("Оставить ваш текст")).toHaveProperty("checked", true);
  expect(submit).toHaveProperty("disabled", false);
  expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toContain(
    "Ours",
  );
  fireEvent.click(submit);
  expect(await screen.findByText("Решение отправлено в docs/task")).toBeTruthy();
  expect(mocks.submit).toHaveBeenCalledTimes(2);
  expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toBeNull();
});

it("preserves visible decisions through a network error and retries the same failed send", async () => {
  render(<BranchConflictResolver {...props} />);
  const choice = await screen.findByLabelText("Оставить ваш текст");
  fireEvent.click(choice);
  vi.useFakeTimers();
  mocks.status
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "failed", last_error: "Push rejected" })
    .mockResolvedValueOnce({ status: "done" });
  mocks.retry.mockResolvedValueOnce(undefined);
  fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Нет связи");
  expect(choice).toHaveProperty("checked", true);
  expect(choice.closest("fieldset.branch-conflict-files")?.hasAttribute("disabled")).toBe(true);
  expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toContain(
    "Ours",
  );
  await act(async () => vi.advanceTimersByTimeAsync(branchConflictLimits.pollMs));
  expect(screen.getByRole("alert").textContent).toBe("Push rejected");
  expect(choice).toHaveProperty("checked", true);
  fireEvent.click(screen.getByRole("button", { name: "Проверить и повторить отправку" }));
  await act(async () => {});
  expect(mocks.retry).toHaveBeenCalledWith("project", "publish");
  expect(mocks.submit).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Решение отправлено в docs/task")).toBeTruthy();
  expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toBeNull();
});

it("resumes an existing failed merge and rechecks blockers if retry is refused", async () => {
  mocks.prepare.mockResolvedValueOnce([
    { branch: "docs/task", paths: [], busy: true, mergeJobId: "old-merge", mergeFailed: true },
  ]);
  mocks.retry.mockRejectedValueOnce(new Error("Branch changed"));
  render(<BranchConflictResolver {...props} />);
  const retry = await screen.findByRole("button", { name: "Проверить и повторить отправку" });
  expect(mocks.inspect).not.toHaveBeenCalled();
  mocks.prepare.mockResolvedValueOnce([{ branch: "docs/task", paths: ["new.md"], busy: false }]);
  fireEvent.click(retry);
  await waitFor(() =>
    expect(mocks.router.replace).toHaveBeenCalledWith(
      "/projects/project/changes?branch=docs%2Ftask&conflict=review",
    ),
  );
  expect(mocks.retry).toHaveBeenCalledWith("project", "old-merge");
  expect(mocks.submit).not.toHaveBeenCalled();
  expect(mocks.inspect).not.toHaveBeenCalled();
});

it.each(["initial", "submit"])("ignores a late %s branch check after leaving", async (stage) => {
  let finish:
    | ((pending: Array<{ branch: string; paths: string[]; busy: boolean }>) => void)
    | undefined;
  const pending = new Promise((resolve) => {
    finish = resolve;
  });
  if (stage === "initial") mocks.prepare.mockReturnValueOnce(pending);
  const view = render(<BranchConflictResolver {...props} />);
  if (stage === "submit") {
    fireEvent.click(await screen.findByLabelText("Оставить ваш текст"));
    mocks.prepare.mockReturnValueOnce(pending);
    fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  }
  view.unmount();
  await act(async () => finish?.([{ branch: "other", paths: ["draft.md"], busy: false }]));
  expect(mocks.router.replace).not.toHaveBeenCalled();
  expect(mocks.submit).not.toHaveBeenCalled();
});

it("discards a late submit response when the review changes without losing either draft", async () => {
  let finish: ((jobId: string) => void) | undefined;
  mocks.submit.mockReturnValueOnce(new Promise<string>((resolve) => (finish = resolve)));
  const view = render(<BranchConflictResolver {...props} />);
  fireEvent.click(await screen.findByLabelText("Оставить ваш текст"));
  fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
  await waitFor(() => expect(mocks.submit).toHaveBeenCalledTimes(1));
  view.rerender(<BranchConflictResolver {...props} reviewId="other-review" />);
  const choice = await screen.findByLabelText("Откатить до stable");
  expect(choice).toHaveProperty("checked", false);
  fireEvent.click(choice);
  await act(async () => finish?.("old-publish"));
  expect(mocks.status).not.toHaveBeenCalledWith("project", "old-publish");
  expect(screen.queryByText("Решение отправлено в docs/task")).toBeNull();
  expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toContain(
    "Ours",
  );
  expect(
    localStorage.getItem('pushdocs:merge-resolution:["user","project","other-review"]'),
  ).toContain("Theirs");
});

it.each([false, true])(
  "ignores a late send status after leaving, including failure: %s",
  async (reject) => {
    let finish: ((value: unknown) => void) | undefined;
    const view = render(<BranchConflictResolver {...props} />);
    fireEvent.click(await screen.findByLabelText("Оставить ваш текст"));
    mocks.status.mockReturnValueOnce(
      new Promise((resolve, fail) => {
        finish = reject ? fail : resolve;
      }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Отправить исправления в docs/task" }));
    await waitFor(() => expect(mocks.status).toHaveBeenCalledWith("project", "publish"));
    view.unmount();
    const invalidate = vi.spyOn(conflictInspectionStore, "invalidate");
    await act(async () => finish?.(reject ? new Error("offline") : { status: "done" }));
    expect(invalidate).not.toHaveBeenCalled();
    expect(localStorage.getItem('pushdocs:merge-resolution:["user","project","review"]')).toContain(
      "Ours",
    );
  },
);
