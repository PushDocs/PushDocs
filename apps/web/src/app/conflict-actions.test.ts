import { branchConflictRepositoryKey } from "@pushdocs/contracts";
import { beforeEach, expect, it, vi } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../../tests/fixtures/branch-update-policy";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  reviews: vi.fn(),
  target: vi.fn(),
  enqueue: vi.fn(),
  active: vi.fn(),
  job: vi.fn(),
  continueRebase: vi.fn(),
  retryUpdate: vi.fn(),
  retryMerge: vi.fn(),
  cancel: vi.fn(),
  provider: vi.fn(),
  branches: vi.fn(),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    listChangeRequests: mocks.reviews,
    getProjectSyncTarget: mocks.target,
    enqueueConflictInspection: mocks.enqueue,
    getActiveReviewBranchUpdate: mocks.active,
    getProjectJob: mocks.job,
    continueRebaseUpdate: mocks.continueRebase,
    retryReviewBranchUpdate: mocks.retryUpdate,
    retryConflictMerge: mocks.retryMerge,
    cancelRebaseUpdate: mocks.cancel,
  }),
}));
vi.mock("@/lib/provider", () => ({ providerForConnection: mocks.provider }));

import {
  cancelRebaseUpdateAction,
  inspectReviewConflictsAction,
  retryConflictResolutionAction,
  submitConflictResolutionAction,
} from "./conflict-actions";

const target = {
  connection_id: "connection",
  base_url: "https://git.example",
  provider_repository_id: "42",
  clone_url: "https://git.example/docs.git",
  kind: "gitlab",
  root_path: "docs",
};
beforeEach(() => {
  vi.resetAllMocks();
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.reviews.mockResolvedValue([
    {
      id: "review",
      external_id: "1",
      source_branch: "task",
      target_branch: "main",
      details: { source: { isFork: false } },
    },
  ]);
  mocks.target.mockResolvedValue(target);
  mocks.provider.mockResolvedValue({
    listBranches: mocks.branches,
    getRepository: vi
      .fn()
      .mockResolvedValue({ defaultUpdateStrategy: resolvedBranchUpdatePolicy().strategy }),
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: 1 })),
  });
  mocks.branches.mockResolvedValue([
    { name: "task", sha: "source" },
    { name: "main", sha: "target" },
  ]);
  mocks.enqueue.mockResolvedValue("inspection");
});

it("validates both live heads before using a cached result", async () => {
  expect(await inspectReviewConflictsAction("project", "review")).toBe("inspection");
  expect(mocks.enqueue).toHaveBeenCalledWith(
    expect.objectContaining({ projectId: "project", reviewId: "review" }),
    {
      parentSha: "source",
      sourceSha: "target",
      repositoryKey: branchConflictRepositoryKey(target),
      updatePolicy: resolvedBranchUpdatePolicy({ configPath: "docs/.pushdocs/config.json" }),
    },
  );
});

it("opens and continues the same paused rebase with the exact conflict token", async () => {
  mocks.active.mockResolvedValue({ id: "rebase", status: "needs_resolution" });
  mocks.continueRebase.mockResolvedValue("rebase");
  expect(await inspectReviewConflictsAction("project", "review", true)).toBe("rebase");
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(
    await submitConflictResolutionAction(
      "project",
      "rebase",
      [{ path: "docs/a.md", choice: "ours" }],
      "token",
    ),
  ).toBe("rebase");
  expect(mocks.continueRebase).toHaveBeenCalledWith({
    projectId: "project",
    operationId: "rebase",
    conflictId: "token",
    userId: "user",
    files: [{ path: "docs/a.md", choice: "ours" }],
  });
  await cancelRebaseUpdateAction("project", "rebase", "token");
  expect(mocks.cancel).toHaveBeenCalledWith("project", "rebase", "token", "user");
});

it("recovers a branch update even when it failed before its first conflict pause", async () => {
  mocks.job.mockResolvedValue({ status: "failed", branchUpdateOperation: true });
  await retryConflictResolutionAction("project", "update");
  expect(mocks.retryUpdate).toHaveBeenCalledWith("project", "update", "user");
  expect(mocks.retryMerge).not.toHaveBeenCalled();
});

it("allows an explicit retry to bypass the completed cache", async () => {
  await inspectReviewConflictsAction("project", "review", true);
  expect(mocks.enqueue).toHaveBeenCalledWith(expect.objectContaining({ refresh: true }), undefined);
});

it("does not contact the provider after access is revoked", async () => {
  mocks.access.mockRejectedValue(new Error("Access denied"));
  await expect(inspectReviewConflictsAction("project", "review")).rejects.toThrow("Access denied");
  expect(mocks.provider).not.toHaveBeenCalled();
  expect(mocks.enqueue).not.toHaveBeenCalled();
});

it("does not reuse results for a deleted source branch", async () => {
  mocks.branches.mockResolvedValue([{ name: "main", sha: "target" }]);
  await expect(inspectReviewConflictsAction("project", "review")).rejects.toThrow("недоступна");
  expect(mocks.enqueue).not.toHaveBeenCalled();
});
