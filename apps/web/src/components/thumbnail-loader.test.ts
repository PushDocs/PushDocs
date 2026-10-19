import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ThumbnailLoader } from "./thumbnail-loader";

let requests: Array<{
  src: string;
  signal: AbortSignal;
  resolve: (response: Response) => void;
  reject: (reason: Error) => void;
}>;
let loader: ThumbnailLoader;
beforeEach(() => {
  requests = [];
  loader = new ThumbnailLoader();
  vi.stubGlobal(
    "fetch",
    vi.fn(
      (src: string, { signal }: { signal: AbortSignal }) =>
        new Promise<Response>((resolve, reject) => requests.push({ src, signal, resolve, reject })),
    ),
  );
  vi.spyOn(URL, "createObjectURL").mockImplementation(() => `blob:${Math.random()}`);
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
});
afterEach(() => loader.dispose());
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const image = (size = 3) => new Response(new Blob(["x".repeat(size)], { type: "image/png" }));

it("pauses queued work, deduplicates consumers and never starts more than four fetches", async () => {
  const ready = vi.fn();
  loader.subscribe("/0", ready, vi.fn());
  loader.subscribe("/0", ready, vi.fn());
  for (let i = 1; i < 8; i++) loader.subscribe(`/${i}`, ready, vi.fn());
  expect(requests).toHaveLength(0);
  loader.setPaused(false);
  expect(requests.map((request) => request.src)).toEqual(["/0", "/1", "/2", "/3"]);
  loader.setPaused(true);
  requests[0]?.resolve(image());
  await flush();
  expect(ready).toHaveBeenCalledTimes(2);
  expect(requests).toHaveLength(4);
  loader.setPaused(false);
  expect(requests.at(-1)?.src).toBe("/4");
});

it("cancels invisible work but keeps its concurrency slot until abort settles", async () => {
  loader.setPaused(false);
  const release = loader.subscribe("/0", vi.fn(), vi.fn());
  for (let i = 1; i < 6; i++) loader.subscribe(`/${i}`, vi.fn(), vi.fn());
  release();
  expect(requests[0]?.signal.aborted).toBe(true);
  expect(requests).toHaveLength(4);
  requests[0]?.reject(new DOMException("Aborted", "AbortError"));
  await flush();
  expect(requests.at(-1)?.src).toBe("/4");
  expect(requests).toHaveLength(5);
});

it("holds the slot during body reading and discards a stale response after resubscription", async () => {
  loader.setPaused(false);
  const stale = vi.fn();
  const release = loader.subscribe("/0", stale, vi.fn());
  let finishBody: (blob: Blob) => void = () => {};
  const response = image();
  vi.spyOn(response, "blob").mockImplementation(
    () => new Promise((resolve) => (finishBody = resolve)),
  );
  requests[0]?.resolve(response);
  await flush();
  release();
  const current = vi.fn();
  loader.subscribe("/0", current, vi.fn());
  for (let i = 1; i < 5; i++) loader.subscribe(`/${i}`, vi.fn(), vi.fn());
  expect(requests).toHaveLength(4);
  finishBody(new Blob(["old"]));
  await flush();
  expect(stale).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(requests).toHaveLength(5);
  requests[1]?.resolve(image());
  await flush();
  expect(current).toHaveBeenCalledOnce();
});

it("reuses cached rasters on reverse scroll and revokes them on disposal", async () => {
  loader.setPaused(false);
  const ready = vi.fn();
  const release = loader.subscribe("/0?revision=1", ready, vi.fn());
  requests[0]?.resolve(image());
  await flush();
  const url = ready.mock.calls[0]?.[0];
  release();
  loader.subscribe("/0?revision=1", ready, vi.fn());
  expect(ready).toHaveBeenLastCalledWith(url);
  expect(requests).toHaveLength(1);
  loader.subscribe("/0?revision=2", vi.fn(), vi.fn());
  expect(requests).toHaveLength(2);
  loader.dispose();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith(url);
  expect(requests[1]?.signal.aborted).toBe(true);
});

it("evicts by bytes and count while protecting images still displayed", async () => {
  loader = new ThumbnailLoader(4, 1, 4);
  loader.setPaused(false);
  const release = loader.subscribe("/pinned", vi.fn(), vi.fn());
  requests[0]?.resolve(image(3));
  await flush();
  const releaseOther = loader.subscribe("/other", vi.fn(), vi.fn());
  requests[1]?.resolve(image(3));
  await flush();
  expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  releaseOther();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
  release();
  const releaseLarge = loader.subscribe("/large", vi.fn(), vi.fn());
  requests[2]?.resolve(image(8));
  await flush();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
  releaseLarge();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(3);
});

it("reports errors without blocking the queue and permits retry", async () => {
  loader = new ThumbnailLoader(1);
  loader.setPaused(false);
  const failed = vi.fn();
  loader.subscribe("/bad", vi.fn(), failed);
  loader.subscribe("/next", vi.fn(), vi.fn());
  requests[0]?.resolve(new Response(null, { status: 403 }));
  await flush();
  expect(failed).toHaveBeenCalledOnce();
  expect(requests[1]?.src).toBe("/next");
  loader.subscribe("/bad", vi.fn(), failed);
  requests[1]?.reject(new Error("Offline"));
  await flush();
  expect(requests[2]?.src).toBe("/bad");
});
