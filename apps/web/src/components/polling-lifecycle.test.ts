import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PollingLifecycle } from "./polling-lifecycle";

const delays = { normal: 2000, retry: 5000 };
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

it("does not overlap requests when started repeatedly or resumed before a response", async () => {
  const pending = deferred<string>();
  const request = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("done");
  const result = vi.fn((value: string) => value !== "done");
  const poller = new PollingLifecycle({ request, onResult: result, onError: vi.fn(), delays });
  poller.start();
  poller.start();
  poller.pause();
  poller.start();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(request).toHaveBeenCalledTimes(1);
  pending.resolve("running");
  await vi.advanceTimersByTimeAsync(0);
  poller.start();
  await vi.advanceTimersByTimeAsync(delays.normal - 1);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  expect(result).toHaveBeenLastCalledWith("done");
  expect(vi.getTimerCount()).toBe(0);
});

it("accepts an in-flight result while paused and resumes only on request", async () => {
  const pending = deferred<string>();
  const request = vi.fn().mockReturnValueOnce(pending.promise).mockResolvedValue("done");
  const result = vi.fn((value: string) => value !== "done");
  const poller = new PollingLifecycle({ request, onResult: result, onError: vi.fn(), delays });
  poller.start();
  poller.pause();
  pending.resolve("running");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(result).toHaveBeenCalledWith("running");
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  expect(request).toHaveBeenCalledTimes(2);
});

it.each([false, true])("discards a disposed request, including rejection: %s", async (reject) => {
  const pending = deferred<string>();
  const request = vi.fn().mockReturnValue(pending.promise);
  const onResult = vi.fn(() => true);
  const onError = vi.fn(() => true);
  const poller = new PollingLifecycle({ request, onResult, onError, delays });
  poller.start();
  poller.dispose();
  poller.start();
  poller.pause();
  if (reject) pending.reject(new Error("offline"));
  else pending.resolve("running");
  await vi.advanceTimersByTimeAsync(10_000);
  expect(onResult).not.toHaveBeenCalled();
  expect(onError).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});

it("uses the retry delay for errors and restores the normal delay after recovery", async () => {
  const request = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValueOnce("running")
    .mockResolvedValue("done");
  const onError = vi.fn(() => true);
  const poller = new PollingLifecycle({
    request,
    onResult: (value) => value !== "done",
    onError,
    delays,
  });
  poller.start();
  await vi.advanceTimersByTimeAsync(delays.retry - 1);
  expect(onError).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(request).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(delays.normal);
  expect(request).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(10_000);
  expect(request).toHaveBeenCalledTimes(3);
});

it.each(["pause", "dispose"] as const)("cancels a scheduled request on %s", async (stop) => {
  const request = vi.fn().mockResolvedValue("running");
  const poller = new PollingLifecycle({
    request,
    onResult: () => true,
    onError: () => true,
    delays,
  });
  poller.start();
  await vi.advanceTimersByTimeAsync(0);
  poller[stop]();
  await vi.advanceTimersByTimeAsync(10_000);
  expect(request).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
