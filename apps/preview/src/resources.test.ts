import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { nodeHeapLimitMb, positiveInteger, runtimeMemoryMb, runtimeProcessIds } from "./resources";

it("counts the whole runtime user's process tree without counting other sites", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "pushdocs-proc-"));
  try {
    for (const [pid, uid, memory] of [
      [1, 11000, 1024],
      [2, 11000, 2048],
      [3, 11001, 4096],
    ]) {
      await mkdir(path.join(root, String(pid)));
      await writeFile(
        path.join(root, String(pid), "status"),
        `Uid:\t${uid}\t${uid}\t${uid}\t${uid}\nVmRSS:\t${memory} kB\n`,
      );
    }
    await mkdir(path.join(root, "4")); // Exited before its status could be read.
    expect(await runtimeMemoryMb(11000, root)).toBe(3);
    expect(await runtimeMemoryMb(11001, root)).toBe(4);
    await mkdir(path.join(root, "5"));
    await writeFile(
      path.join(root, "5/status"),
      "Uid:\t11000\t11000\t11000\t11000\nState:\tZ (zombie)\n",
    );
    expect((await runtimeProcessIds(11000, root)).sort()).toEqual([1, 2]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("does not increase V8 heap automatically when the whole-site RSS budget increases", () => {
  expect(nodeHeapLimitMb(4096)).toBe(1536);
  expect(nodeHeapLimitMb(5120)).toBe(1536);
  expect(nodeHeapLimitMb(5120, 2048)).toBe(2048);
  expect(nodeHeapLimitMb(256)).toBe(128);
});

it("rejects invalid limits instead of silently disabling resource control", () => {
  expect(positiveInteger(undefined, 1, "limit")).toBe(1);
  for (const value of [0, -1, "oops", 1.5])
    expect(() => positiveInteger(value, 1, "limit")).toThrow();
});
