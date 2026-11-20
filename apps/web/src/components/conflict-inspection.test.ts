import { branchConflictLimits } from "@pushdocs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ inspect: vi.fn(), status: vi.fn() }));
vi.mock("@/app/actions", () => ({ gitOperationStatusAction: mocks.status }));
vi.mock("@/app/conflict-actions", () => ({ inspectReviewConflictsAction: mocks.inspect }));

import { ConflictLoadState, conflictInspectionStore } from "./conflict-inspection";

const request = {
  projectId: "project",
  reviewId: "review",
  branch: "docs/task",
  targetBranch: "main",
};
const snapshot = {
  branch: "docs/task",
  sourceBranch: "main",
  parentSha: "parent",
  sourceSha: "target",
  files: [],
};

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  conflictInspectionStore.clear();
  mocks.inspect.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done", conflictSnapshot: snapshot });
});
afterEach(() => {
  conflictInspectionStore.clear();
  vi.useRealTimers();
});

it("keeps downloading after subscribers leave and reuses the result when they return", async () => {
  mocks.status.mockResolvedValueOnce({
    status: "running",
    progress: "comparing-conflicts",
    transferProgress: { receivedBytes: 12_500_000, totalBytes: null },
  });
  const unsubscribe = conflictInspectionStore.subscribe(vi.fn());
  conflictInspectionStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(conflictInspectionStore.getSnapshot()[0]?.transfer?.receivedBytes).toBe(12_500_000);
  unsubscribe();
  conflictInspectionStore.ensure(request);
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(2000);
  expect(conflictInspectionStore.getSnapshot()[0]?.inspection?.snapshot).toEqual(snapshot);
  conflictInspectionStore.ensure(request);
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
});

it("preserves the active operation during a network error and resumes its polling", async () => {
  mocks.status.mockRejectedValueOnce(new TypeError("Offline"));
  conflictInspectionStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(conflictInspectionStore.getSnapshot()[0]?.state).toBe(ConflictLoadState.Running);
  await vi.advanceTimersByTimeAsync(2000);
  expect(conflictInspectionStore.getSnapshot()[0]?.state).toBe(ConflictLoadState.Done);
  expect(mocks.inspect).toHaveBeenCalledTimes(1);
});

it("refreshes explicitly and clears cached results when the user changes", async () => {
  conflictInspectionStore.setOwner("first");
  conflictInspectionStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  conflictInspectionStore.ensure(request, true);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.inspect).toHaveBeenLastCalledWith("project", "review", true);
  conflictInspectionStore.setOwner("second");
  expect(conflictInspectionStore.getSnapshot()).toEqual([]);
});

it("keeps the previous inspection through refresh startup and polling until a new result arrives", async () => {
  conflictInspectionStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  const previous = conflictInspectionStore.getSnapshot()[0]?.inspection;
  const updated = { ...snapshot, parentSha: "updated" };
  mocks.inspect.mockResolvedValueOnce("refresh");
  mocks.status
    .mockResolvedValueOnce({ status: "running" })
    .mockResolvedValueOnce({ status: "done", conflictSnapshot: updated });

  conflictInspectionStore.ensure(request, true);
  expect(conflictInspectionStore.getSnapshot()[0]?.state).toBe(ConflictLoadState.Starting);
  expect(conflictInspectionStore.getSnapshot()[0]?.inspection).toBe(previous);
  await vi.advanceTimersByTimeAsync(0);
  expect(conflictInspectionStore.getSnapshot()[0]?.state).toBe(ConflictLoadState.Running);
  expect(conflictInspectionStore.getSnapshot()[0]?.inspection).toBe(previous);
  await vi.advanceTimersByTimeAsync(branchConflictLimits.pollMs);
  expect(conflictInspectionStore.getSnapshot()[0]?.state).toBe(ConflictLoadState.Done);
  expect(conflictInspectionStore.getSnapshot()[0]?.inspection).toEqual({
    id: "refresh",
    snapshot: updated,
  });
});

it.each([false, true])(
  "ignores a late inspection status after invalidation: %s",
  async (reject) => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.status.mockReturnValueOnce(
      new Promise((resolve, fail) => {
        finish = reject ? fail : resolve;
      }),
    );
    conflictInspectionStore.ensure(request);
    await vi.advanceTimersByTimeAsync(0);
    conflictInspectionStore.invalidate(request.projectId, request.reviewId);
    finish?.(reject ? new Error("offline") : { status: "done", conflictSnapshot: snapshot });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(conflictInspectionStore.getSnapshot()).toEqual([]);
    expect(mocks.status).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  },
);
