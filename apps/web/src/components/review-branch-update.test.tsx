// @vitest-environment jsdom

import {
  BranchUpdateStrategy,
  type ChangeRequestDetails,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../../tests/fixtures/branch-update-policy";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/app/conflict-actions", () => ({
  prepareConflictResolutionAction: vi.fn(),
  inspectReviewConflictsAction: vi.fn(),
  submitConflictResolutionAction: vi.fn(),
  retryConflictResolutionAction: vi.fn(),
  cancelRebaseUpdateAction: vi.fn(),
}));

import { clearDraft, draftKey, writeDraft } from "./draft-storage";
import { gitOperationStore } from "./git-operation-store";
import { gitOperationPollingDelays } from "./git-operation-timing";
import { ReviewBranchUpdate } from "./review-branch-update";

afterEach(() => {
  cleanup();
  gitOperationStore.clear();
  localStorage.clear();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function details(state: ChangeRequestDetails["readiness"]["state"], reason: string | null) {
  return {
    headSha: "sha",
    readiness: { state, reason },
    labels: null,
    approvals: null,
    comments: null,
    commentsComplete: false,
  } satisfies ChangeRequestDetails;
}

function mount(
  reason = "need_rebase",
  overrides: Partial<Parameters<typeof ReviewBranchUpdate>[0]> = {},
) {
  const props = {
    projectId: "project",
    ownerId: "user",
    canWrite: true,
    provider: "gitlab" as const,
    review: {
      id: "review",
      head_sha: "sha",
      source_branch: "docs/fix #1",
      target_branch: "release",
      provider_url: "https://git.example/review/42",
      details: {
        ...details("blocked", reason),
        branchUpdatePolicy: resolvedBranchUpdatePolicy({
          strategy:
            reason === "need_rebase" ? BranchUpdateStrategy.Rebase : BranchUpdateStrategy.Merge,
        }),
        source: { isFork: false, repositoryId: "main", branchUrl: null },
      },
    },
    ...overrides,
  };
  return render(<ReviewBranchUpdate {...props} />);
}

it.each([
  ["blocked", "need_rebase", true],
  ["blocked", "behind", true],
  ["blocked", "conflict", false],
  ["blocked", "dirty", false],
  ["blocked", "not_approved", false],
  ["ready", "behind", true],
  ["checking", "need_rebase", true],
  ["unknown", null, false],
] as const)("identifies an actionable update for %s/%s", (state, reason, expected) => {
  expect(needsBranchUpdate(details(state, reason))).toBe(expected);
});

it("does not infer branch updates from unavailable provider data", () => {
  expect(needsBranchUpdate(null)).toBe(false);
  expect(needsBranchUpdate(undefined)).toBe(false);
});

it("blocks an update until a legacy review has a resolved policy", () => {
  mount("need_rebase", {
    review: {
      id: "review",
      head_sha: "sha",
      source_branch: "docs/task",
      target_branch: "release",
      provider_url: "https://git.example/review/42",
      details: {
        ...details("blocked", "need_rebase"),
        source: { isFork: false, repositoryId: "main", branchUrl: null },
      },
    },
  });
  expect(screen.getByRole("alert").textContent).toContain("Обновление пока недоступно");
  expect(
    (screen.getByRole("button", { name: "Обновить ветку" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.start).not.toHaveBeenCalled();
});

it.each([
  { provider: "gitlab", reason: "need_rebase" },
  { provider: "github", reason: "behind" },
] as const)(
  "updates $provider branches in one click without technical explanations",
  async ({ provider, reason }) => {
    mocks.start.mockResolvedValue("job");
    mocks.status.mockResolvedValue({ status: "done" });
    const { container } = mount(reason, { provider });
    expect(screen.queryByRole("heading", { name: "Обновите ветку" })).toBeNull();
    expect(container.querySelector(".branch-notice")).toBeNull();
    expect(container.textContent).not.toMatch(/release|SHA|rebase|merge|MR|PR/);
    expect(screen.queryByRole("link", { name: /Открыть .* в Git/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
    expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Обновить и отправить в Git" })).toBeNull();
    await act(async () => {});
    expect(mocks.start).toHaveBeenCalledWith({
      projectId: "project",
      branch: "docs/fix #1",
      updateReview: {
        reviewId: "review",
        expectedHeadSha: "sha",
        expectedStrategy:
          reason === "need_rebase" ? BranchUpdateStrategy.Rebase : BranchUpdateStrategy.Merge,
      },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Ветка обновлена.");
  },
);

it("disables the update action while it runs and avoids duplicate starts", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  const action = screen.getByRole("button", { name: "Обновляем ветку…" });
  expect(action).toHaveProperty("disabled", true);
  fireEvent.click(action);
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("replaces the update notice with a conflict notice when the current commit needs resolution", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "needs_resolution" });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(screen.queryByRole("region", { name: "Обновление ветки" })).toBeNull();
  expect(screen.getByRole("heading", { name: "Исправьте конфликты" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Исправить конфликты" }).getAttribute("href")).toBe(
    "/projects/project/changes?branch=docs%2Ffix+%231&resolve=review",
  );
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("opens a paused update with a conflict notice without starting another operation", () => {
  mount("need_rebase", {
    activeStrategy: BranchUpdateStrategy.Rebase,
    activeHeadSha: "sha",
    waitingForResolution: true,
  });
  expect(screen.getByRole("heading", { name: "Исправьте конфликты" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("keeps reader and fork mutations disabled", () => {
  const view = mount("need_rebase", { canWrite: false });
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toHaveProperty("disabled", true);
  view.unmount();
  mount("behind", {
    review: {
      id: "fork",
      source_branch: "main",
      target_branch: "release",
      provider_url: "https://git.example/fork",
      details: {
        ...details("blocked", "behind"),
        source: { isFork: true, repositoryId: "fork", branchUrl: null },
      },
    },
  });
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toHaveProperty("disabled", true);
  expect(mocks.start).not.toHaveBeenCalled();
});

it("shows saved changes as the next step before updating the branch", () => {
  mount("need_rebase", { hasPendingChanges: true });
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("shows browser drafts before the update action and restores it when drafts are cleared", () => {
  const key = draftKey("project", "docs/fix #1", "docs/a.md", "user");
  writeDraft(key, "Unsaved", "Original");
  mount();
  expect(screen.queryByRole("region", { name: "Обновление ветки" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(screen.getByRole("link", { name: "Открыть правки" })).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toContain("Unsaved");
  clearDraft(key);
  fireEvent(window, new Event("storage"));
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toBeTruthy();
  expect(screen.queryByText("Сохраните текущие правки")).toBeNull();
});

it("rechecks the source branch's local drafts before starting an update and preserves them", async () => {
  mount();
  writeDraft(draftKey("project", "docs/fix #1", "docs/a.md", "user"), "Unsaved", "Original");
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(screen.queryByRole("region", { name: "Обновление ветки" })).toBeNull();
  expect(screen.getByRole("link", { name: "Открыть правки" }).getAttribute("href")).toContain(
    "branch=docs%2Ffix+%231",
  );
  expect(mocks.start).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
  clearDraft(draftKey("project", "docs/fix #1", "docs/a.md", "user"));
  fireEvent.focus(window);
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toBeTruthy();
});

it("reports server blockers and permits retry without losing the selected review", async () => {
  mocks.start
    .mockResolvedValueOnce({ error: "Сначала завершите текущие изменения в исходной ветке." })
    .mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done" });
  writeDraft(draftKey("project", "unrelated", "docs/a.md", "user"), "Other work", "Original");
  mount();
  for (let attempt = 0; attempt < 2; attempt++) {
    fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
    await act(async () => {});
    if (attempt === 0)
      expect(screen.getByRole("alert").textContent).toBe(
        "Не удалось обновить ветку. Попробуйте ещё раз.",
      );
  }
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("continues polling after navigation without starting another update", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  view.unmount();
  mocks.status.mockResolvedValue({ status: "done" });
  mount();
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("shows the second attempt and restores the action after its failure", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({
      status: "queued",
      attempt: 1,
      maxAttempts: 2,
      last_error: "Git fetch failed",
    })
    .mockResolvedValueOnce({ status: "running", attempt: 2, maxAttempts: 2 })
    .mockResolvedValueOnce({
      status: "failed",
      attempt: 2,
      maxAttempts: 2,
      last_error: "Git fetch failed",
    });
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(screen.getByRole("status").textContent).toBe(
    "Запрос завершился ошибкой. Ожидаем повтор: попытка 2 из 2.",
  );
  expect(screen.getByRole("button", { name: "Обновляем ветку…" })).toHaveProperty("disabled", true);
  await act(() => vi.advanceTimersByTimeAsync(gitOperationPollingDelays.normal));
  expect(screen.getByRole("status").textContent).toBe("Повторяем запрос: попытка 2 из 2…");
  await act(() => vi.advanceTimersByTimeAsync(gitOperationPollingDelays.normal));
  expect(screen.getByRole("alert").textContent).toBe(
    "Не удалось обновить ветку. Попробуйте ещё раз.",
  );
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toHaveProperty("disabled", false);
  await act(() => vi.advanceTimersByTimeAsync(gitOperationPollingDelays.normal));
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.refresh).not.toHaveBeenCalled();
  mocks.status.mockResolvedValue({ status: "done", attempt: 1, maxAttempts: 2 });
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toBe("Ветка обновлена.");
});

it("resumes an existing update in one click after MR data disappears, even with newer local drafts", async () => {
  mocks.start.mockResolvedValue("same-job");
  mocks.status.mockResolvedValue({ status: "done" });
  writeDraft(draftKey("project", "docs/fix #1", "docs/new.md", "user"), "New local work", "");
  mount("need_rebase", {
    hasPendingChanges: true,
    activeStrategy: BranchUpdateStrategy.Rebase,
    activeHeadSha: "original-head",
    review: {
      id: "review",
      head_sha: null,
      source_branch: "docs/fix #1",
      target_branch: "release",
      provider_url: "https://git.example/review/42",
      details: null,
    },
  });
  expect(screen.queryByText(/Продолжите обновление/)).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  expect(screen.queryByRole("button", { name: "Обновить и отправить в Git" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Отмена" })).toBeNull();
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({
      updateReview: {
        reviewId: "review",
        expectedHeadSha: "original-head",
        expectedStrategy: BranchUpdateStrategy.Rebase,
      },
    }),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(1);
});
