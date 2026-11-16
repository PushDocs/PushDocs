// @vitest-environment jsdom
import {
  BranchUpdateStrategy,
  type ChangeRequestDetails,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { clearDraft, draftKey, writeDraft } from "./draft-storage";
import { gitOperationStore } from "./git-operation-store";
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
  ["ready", "behind", false],
  ["checking", "need_rebase", false],
  ["unknown", null, false],
] as const)("identifies an actionable update for %s/%s", (state, reason, expected) => {
  expect(needsBranchUpdate(details(state, reason))).toBe(expected);
});

it("does not infer branch updates from unavailable provider data", () => {
  expect(needsBranchUpdate(null)).toBe(false);
  expect(needsBranchUpdate(undefined)).toBe(false);
});

it.each([
  { provider: "gitlab", reviewLabel: "MR", reason: "need_rebase" },
  { provider: "github", reviewLabel: "PR", reason: "behind" },
] as const)(
  "updates $provider branches inside PushDocs after confirmation",
  async ({ provider, reviewLabel, reason }) => {
    mocks.start.mockResolvedValue("job");
    mocks.status.mockResolvedValue({ status: "done" });
    const { container } = mount(reason, { provider });
    expect(screen.getByRole("region", { name: "Обновление ветки" }).textContent).toContain(
      "release",
    );
    expect(screen.queryByRole("link", { name: /Открыть .* в Git/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
    expect(mocks.start).not.toHaveBeenCalled();
    expect(container.textContent?.includes("SHA изменятся")).toBe(reason === "need_rebase");
    expect(container.textContent).toContain(
      `${reviewLabel} обновится автоматически и останется открытым`,
    );
    fireEvent.click(screen.getByRole("button", { name: "Обновить и отправить в Git" }));
    await act(async () => {});
    expect(mocks.start).toHaveBeenCalledWith({
      projectId: "project",
      branch: "docs/fix #1",
      updateReview: { reviewId: "review", expectedHeadSha: "sha" },
    });
    expect(mocks.refresh).toHaveBeenCalledOnce();
    expect(screen.getByRole("status").textContent).toContain("Ветка обновлена и отправлена в Git");
  },
);

it("cancels confirmation without touching Git", () => {
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(screen.queryByText(/SHA изменятся/)).toBeNull();
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
  expect(screen.getByRole("heading", { name: "Сначала завершите текущие правки" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("shows browser drafts before the update action and restores it when drafts are cleared", () => {
  const key = draftKey("project", "docs/fix #1", "docs/a.md", "user");
  writeDraft(key, "Unsaved", "Original");
  mount();
  expect(screen.getByRole("heading", { name: "Сначала завершите текущие правки" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(screen.getByRole("link", { name: "Открыть локальные правки" })).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
  expect(localStorage.getItem(key)).toContain("Unsaved");
  clearDraft(key);
  fireEvent(window, new Event("storage"));
  expect(screen.getByRole("button", { name: "Обновить ветку" })).toBeTruthy();
  expect(screen.queryByText("Сначала завершите текущие правки")).toBeNull();
});

it("rechecks the source branch's local drafts before starting an update and preserves them", async () => {
  mount();
  writeDraft(draftKey("project", "docs/fix #1", "docs/a.md", "user"), "Unsaved", "Original");
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  fireEvent.click(screen.getByRole("button", { name: "Обновить и отправить в Git" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("локальные правки");
  expect(
    screen.getByRole("link", { name: "Открыть локальные правки" }).getAttribute("href"),
  ).toContain("branch=docs%2Ffix+%231");
  expect(mocks.start).not.toHaveBeenCalled();
  expect(localStorage.length).toBe(1);
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
    fireEvent.click(screen.getByRole("button", { name: "Обновить и отправить в Git" }));
    await act(async () => {});
    if (attempt === 0) expect(screen.getByRole("alert").textContent).toContain("Сначала завершите");
  }
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("continues polling after navigation without starting another update", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  const view = mount();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  fireEvent.click(screen.getByRole("button", { name: "Обновить и отправить в Git" }));
  await act(async () => {});
  view.unmount();
  mocks.status.mockResolvedValue({ status: "done" });
  mount();
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("can reconcile an existing update after MR data disappears, even with newer local drafts", async () => {
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
  fireEvent.click(screen.getByRole("button", { name: "Продолжить обновление ветки" }));
  expect(screen.getByText(/проверит результат предыдущей отправки/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Обновить и отправить в Git" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith(
    expect.objectContaining({
      updateReview: { reviewId: "review", expectedHeadSha: "original-head" },
    }),
  );
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(localStorage.length).toBe(1);
});
