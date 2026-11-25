// @vitest-environment jsdom

import { BranchCreationStatusFailure } from "@pushdocs/contracts";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  BranchCreationCancelled,
  BranchCreationObserver,
  BranchCreationOperationKind,
  BranchCreationReadError,
  branchCreationSessions,
} from "./branch-creation-session";

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/app/actions", () => ({ branchCreationStatusAction: mocks.status }));

const scope = { ownerId: "actor", projectId: "project", sourceBranch: "main" };
const operation = {
  jobId: "job",
  name: "docs/new",
  sourceBranch: "main",
  kind: BranchCreationOperationKind.Create,
};

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  branchCreationSessions.clear();
  mocks.status.mockReset();
});
afterEach(() => {
  branchCreationSessions.clear();
  vi.useRealTimers();
});

it.each([
  BranchCreationStatusFailure.AuthenticationRequired,
  BranchCreationStatusFailure.AccessDenied,
  BranchCreationStatusFailure.NotFound,
])("stops polling on the permanent status failure %s", async (error) => {
  mocks.status.mockResolvedValue({ error });
  const observer = new BranchCreationObserver();
  const onJob = vi.fn();
  await expect(observer.wait("project", "job", onJob, vi.fn())).rejects.toBeInstanceOf(
    BranchCreationReadError,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  expect(mocks.status).toHaveBeenCalledOnce();
  expect(onJob).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

it("retries a transport failure and returns to the shared normal polling interval", async () => {
  mocks.status
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce({ job: { status: "running" } })
    .mockResolvedValueOnce({ job: { status: "done" } });
  const observer = new BranchCreationObserver();
  const onRetry = vi.fn();
  const waiting = observer.wait("project", "job", vi.fn(), onRetry);
  await vi.advanceTimersByTimeAsync(4999);
  expect(mocks.status).toHaveBeenCalledOnce();
  expect(onRetry).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(mocks.status).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2000);
  await expect(waiting).resolves.toMatchObject({ status: "done" });
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
});

it("stops consecutive transport failures and permits an explicit status-only retry", async () => {
  mocks.status.mockRejectedValue(new Error("offline"));
  const observer = new BranchCreationObserver();
  const waiting = expect(observer.wait("project", "job", vi.fn(), vi.fn())).rejects.toBeInstanceOf(
    BranchCreationReadError,
  );
  await vi.advanceTimersByTimeAsync(60_000);
  await waiting;
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(vi.getTimerCount()).toBe(0);
  mocks.status.mockResolvedValue({ job: { status: "done" } });
  await expect(observer.wait("project", "job", vi.fn(), vi.fn())).resolves.toMatchObject({
    status: "done",
  });
});

it.each([false, true])(
  "settles cancellation immediately and ignores a late result: %s",
  async (reject) => {
    let finish: ((value: unknown) => void) | undefined;
    let fail: ((error: Error) => void) | undefined;
    mocks.status.mockReturnValue(
      new Promise((resolve, reject) => {
        finish = resolve;
        fail = reject;
      }),
    );
    const observer = new BranchCreationObserver();
    const onJob = vi.fn();
    const onRetry = vi.fn();
    const waiting = expect(observer.wait("project", "job", onJob, onRetry)).rejects.toBeInstanceOf(
      BranchCreationCancelled,
    );
    observer.dispose();
    await waiting;
    if (reject) fail?.(new Error("offline"));
    else finish?.({ job: { status: "done" } });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(onJob).not.toHaveBeenCalled();
    expect(onRetry).not.toHaveBeenCalled();
    expect(mocks.status).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  },
);

it("restores a confirmed job after a reload and scopes it to its actor and project", () => {
  branchCreationSessions.remember(scope, operation);
  branchCreationSessions.clear();
  expect(branchCreationSessions.read(scope)).toEqual(operation);
  expect(branchCreationSessions.read({ ...scope, ownerId: "another" })).toBeUndefined();
  expect(branchCreationSessions.read({ ...scope, projectId: "another" })).toBeUndefined();
  expect(branchCreationSessions.read({ ...scope, ownerId: undefined })).toBeUndefined();
});

it("does not let completion of an older job clear its replacement", () => {
  branchCreationSessions.remember(scope, operation);
  branchCreationSessions.remember(scope, { ...operation, jobId: "replacement" });
  branchCreationSessions.forget(scope, operation.jobId);
  expect(branchCreationSessions.read(scope)?.jobId).toBe("replacement");
  branchCreationSessions.forget(scope, "replacement");
  branchCreationSessions.clear();
  expect(branchCreationSessions.read(scope)).toBeUndefined();
});

it("joins an in-flight enqueue and persists its late confirmation for the next observer", async () => {
  let finish: ((value: { jobId: string; name: string }) => void) | undefined;
  const request = vi.fn(
    () =>
      new Promise<{ jobId: string; name: string }>((resolve) => {
        finish = resolve;
      }),
  );
  const first = branchCreationSessions.enqueue(scope, operation.name, operation.kind, request);
  const second = branchCreationSessions.enqueue(scope, operation.name, operation.kind, request);
  await Promise.resolve();
  expect(first).toBe(second);
  expect(request).toHaveBeenCalledOnce();
  finish?.({ jobId: "job", name: operation.name });
  await expect(first).resolves.toEqual(operation);
  expect(branchCreationSessions.read(scope)).toEqual(operation);
  expect(branchCreationSessions.pending(scope)).toBeUndefined();
});

it("keeps live recovery available when session storage is disabled", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  branchCreationSessions.remember(scope, operation);
  expect(branchCreationSessions.read(scope)).toEqual(operation);
  expect(() => branchCreationSessions.forget(scope, "job")).not.toThrow();
});

it("ignores malformed saved operation pointers", () => {
  branchCreationSessions.remember(scope, operation);
  const key = sessionStorage.key(0);
  expect(key).toBeTruthy();
  sessionStorage.setItem(key ?? "", JSON.stringify({ version: 1, jobId: "job", name: false }));
  branchCreationSessions.clear();
  expect(branchCreationSessions.read(scope)).toBeUndefined();
});
