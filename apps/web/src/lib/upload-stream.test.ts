import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { storeUpload } from "./upload-stream";

it("streams a multi-chunk upload and records its size and hash", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pushdocs-upload-test-"));
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("hello"));
        controller.enqueue(new TextEncoder().encode(" world"));
        controller.close();
      },
    });
    expect(await storeUpload(stream, path.join(dir, "asset"), 64)).toEqual({
      size: 11,
      sha256: "b94d27b9934d3e08a52e52d7da7dabfac484efe37a5380ee9088f7ace2efcde9",
    });
    expect(await readFile(path.join(dir, "asset"), "utf8")).toBe("hello world");
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("rejects an oversized stream and removes the incomplete file", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pushdocs-upload-test-"));
  try {
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(12));
        controller.close();
      },
    });
    await expect(storeUpload(stream, path.join(dir, "asset"), 10)).rejects.toThrow("лимит");
    await expect(readFile(path.join(dir, "asset"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("rejects an empty stream and removes its placeholder", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pushdocs-upload-test-"));
  try {
    const stream = new ReadableStream({ start: (controller) => controller.close() });
    await expect(storeUpload(stream, path.join(dir, "asset"), 10)).rejects.toThrow("Пустой файл");
    await expect(readFile(path.join(dir, "asset"))).rejects.toThrow();
  } finally {
    await rm(dir, { recursive: true });
  }
});

it("preserves the original read error when cleanup also fails", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pushdocs-upload-test-"));
  const destination = path.join(dir, "asset");
  const releaseLock = vi.fn();
  const original = new Error("read failed");
  const body = {
    getReader: () => ({
      read: async () => {
        throw original;
      },
      cancel: async () => {
        await rm(destination, { force: true });
        throw new Error("cancel failed");
      },
      releaseLock,
    }),
  } as unknown as ReadableStream<Uint8Array>;
  try {
    await expect(storeUpload(body, destination, 10)).rejects.toBe(original);
    expect(releaseLock).toHaveBeenCalledOnce();
  } finally {
    await rm(dir, { recursive: true });
  }
});
