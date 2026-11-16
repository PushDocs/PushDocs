import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), status: vi.fn() }));
vi.mock("@/app/actions", () => ({
  synchronizeBranchAction: mocks.sync,
  gitOperationStatusAction: mocks.status,
}));

import { BranchImportState, branchImportStore } from "./branch-import-store";

const request = { projectId: "project", branch: "docs/task" };
beforeEach(() => {
  vi.useFakeTimers();
  branchImportStore.clear();
  vi.clearAllMocks();
  mocks.sync.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
});
afterEach(() => {
  branchImportStore.clear();
  vi.useRealTimers();
});

it("keeps stable snapshots and distinguishes projects and branches", async () => {
  branchImportStore.ensure(request);
  const snapshot = branchImportStore.getSnapshot();
  expect(branchImportStore.getSnapshot()).toBe(snapshot);
  branchImportStore.ensure(request);
  branchImportStore.ensure({ ...request, projectId: "other" });
  branchImportStore.ensure({ ...request, branch: "other" });
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sync).toHaveBeenCalledTimes(3);
  expect(branchImportStore.getSnapshot()).toHaveLength(3);
});

it("expires completed results while preserving running tasks until the server finishes", async () => {
  mocks.status.mockResolvedValueOnce({ status: "done" });
  branchImportStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  branchImportStore.ensure(request);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60_000);
  branchImportStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(300_000);
  branchImportStore.ensure(request, true);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

it("ignores a late start response after changing the account", async () => {
  branchImportStore.connect("first");
  let finish: ((jobId: string) => void) | undefined;
  mocks.sync.mockReturnValueOnce(
    new Promise<string>((resolve) => {
      finish = resolve;
    }),
  );
  branchImportStore.ensure(request);
  branchImportStore.connect("second");
  finish?.("old-job");
  await vi.advanceTimersByTimeAsync(0);
  expect(branchImportStore.getSnapshot()).toEqual([]);
  expect(mocks.status).not.toHaveBeenCalled();
});

it("does not let an old cleanup clear a newer connection and clears polls on logout", async () => {
  const disconnect = branchImportStore.connect("first");
  const disconnectCurrent = branchImportStore.connect("second");
  branchImportStore.ensure(request);
  disconnect();
  await vi.advanceTimersByTimeAsync(0);
  expect(branchImportStore.getSnapshot()).toHaveLength(1);
  disconnectCurrent();
  await vi.advanceTimersByTimeAsync(0);
  expect(branchImportStore.getSnapshot()).toEqual([]);
  const polls = mocks.status.mock.calls.length;
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.status).toHaveBeenCalledTimes(polls);
});

it.each([false, true])(
  "ignores a late status response or failure after logout: %s",
  async (reject) => {
    let finish: ((value: unknown) => void) | undefined;
    mocks.status.mockReturnValueOnce(
      new Promise((resolve, fail) => {
        finish = reject ? fail : resolve;
      }),
    );
    branchImportStore.ensure(request);
    await vi.advanceTimersByTimeAsync(0);
    branchImportStore.clear();
    finish?.(reject ? new Error("offline") : { status: "done" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(branchImportStore.getSnapshot()).toEqual([]);
    expect(mocks.status).toHaveBeenCalledTimes(1);
  },
);

it("does not automatically retry a failed task on return", async () => {
  mocks.status.mockResolvedValueOnce({ status: "failed" });
  branchImportStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  expect(branchImportStore.getSnapshot()[0]?.state).toBe(BranchImportState.Failed);
  await vi.advanceTimersByTimeAsync(60_000);
  branchImportStore.ensure(request);
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  branchImportStore.ensure(request, true);
  expect(mocks.sync).toHaveBeenCalledTimes(2);
});

it("continues a background import after a network error using the retry delay", async () => {
  const unsubscribe = branchImportStore.subscribe(vi.fn());
  mocks.status
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ status: "done" });
  branchImportStore.ensure(request);
  await vi.advanceTimersByTimeAsync(0);
  unsubscribe();
  expect(branchImportStore.getSnapshot()[0]?.notice).toContain("Нет связи");
  await vi.advanceTimersByTimeAsync(4999);
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(branchImportStore.getSnapshot()[0]?.state).toBe(BranchImportState.Done);
  expect(branchImportStore.getSnapshot()[0]?.notice).toBeUndefined();
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.status).toHaveBeenCalledTimes(2);
});
