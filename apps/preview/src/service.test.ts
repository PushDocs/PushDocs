import { mkdir, mkdtemp, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import {
  createPreviewService,
  previewEndpointReady,
  previewExitError,
  retryGitFetch,
  run,
} from "./service";
import { leafCheckoutDirectories, workspaceKey } from "./workspaces";

const service = createPreviewService({ repository: {} as never });

it("shows the actual site error instead of the update advertisement even after exit code zero", () => {
  const message = previewExitError(
    "Update available 3.6.3 → 3.10.2\nyarn upgrade packages\n[INFO] Starting the development server...\n[ERROR] Something is already running on port 43000.\nDone in 3.59s.",
    0,
    null,
  );
  expect(message).toContain("Something is already running on port 43000");
  expect(message).not.toContain("yarn upgrade");
  expect(message).not.toContain("Update available");
});

it("reports a subprocess timeout instead of an exit code of null", async () => {
  await expect(
    run([process.execPath, "-e", "setTimeout(() => {}, 10000)"], {
      cwd: process.cwd(),
      timeoutMs: 30,
    }),
  ).rejects.toThrow("превысил время ожидания");
});

it("splits a tree into leaf directories so large checkouts can fetch smaller packs", () => {
  expect(
    leafCheckoutDirectories(
      "docs\0staticLocalized\0staticLocalized/ru\0staticLocalized/ru/img\0staticLocalized/ru/img/a\0staticLocalized/ru/img/b\0staticLocalized/en\0",
    ),
  ).toEqual(["docs", "staticLocalized/en", "staticLocalized/ru/img/a", "staticLocalized/ru/img/b"]);
});

it("expands only whole preview command placeholders", () => {
  expect(service.commandArgs(["yarn", "start", "--port", "{port}"], 43000)).toEqual([
    "yarn",
    ["start", "--port", "43000"],
  ]);
  expect(() => service.commandArgs(["yarn", "--port={port}"], 43000)).toThrow("отдельные");
});

it("retries an interrupted Git fetch but does not retry permanent failures", async () => {
  let calls = 0;
  const retries: number[] = [];
  const result = await retryGitFetch(
    async () => {
      calls++;
      if (calls === 1)
        throw new Error(
          "git завершился с кодом 128: unexpected disconnect; early EOF; invalid index-pack output",
        );
      return "ok";
    },
    {
      delay: async () => {},
      onRetry: (_error, attempt) => {
        retries.push(attempt);
      },
    },
  );
  expect(result).toBe("ok");
  expect(calls).toBe(2);
  expect(retries).toEqual([1]);

  let permanentCalls = 0;
  await expect(
    retryGitFetch(
      async () => {
        permanentCalls++;
        throw new Error("authentication failed");
      },
      { delay: async () => {} },
    ),
  ).rejects.toThrow("authentication failed");
  expect(permanentCalls).toBe(1);
});

it("requeues a persisted ready session when its runner process has restarted", async () => {
  const workspaceRoot = await mkdtemp(path.join(tmpdir(), "pushdocs-preview-test-"));
  const updatePreviewSession = vi.fn(async () => undefined);
  try {
    const preview = createPreviewService({
      workspaceRoot,
      repository: {
        reconcilePreviewLeases: async () => undefined,
        listPreviewSessions: async () => [
          {
            id: "00000000-0000-4000-8000-000000000001",
            desired_state: "running",
            status: "ready",
            updated_at: new Date(),
          },
        ],
        updatePreviewSession,
      } as never,
    });
    await preview.tick();
    expect(updatePreviewSession).toHaveBeenCalledWith("00000000-0000-4000-8000-000000000001", {
      status: "queued",
    });
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

it("does not mark a preview ready when its HTTP endpoint returns an error", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = vi.fn(async () => new Response("Build failed", { status: 500 }));
    expect(await previewEndpointReady(43000)).toBe(false);
    globalThis.fetch = vi.fn(async () => new Response("OK", { status: 200 }));
    expect(await previewEndpointReady(43000)).toBe(true);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

it.each([
  { days: 2, bytes: 100, cacheMaxMb: 8192 },
  { days: 0.5, bytes: 2 * 1024 * 1024, cacheMaxMb: 1 },
])(
  "cleans caches after one day or above the budget without immediately prewarming them: %j",
  async ({ days, bytes, cacheMaxMb }) => {
    const workspaceRoot = await mkdtemp(path.join(tmpdir(), "pushdocs-preview-budget-"));
    const ref = { projectId: "project", branch: "stable" };
    const directory = path.join(workspaceRoot, "worktrees", workspaceKey(ref));
    const listChangedWorkingFiles = vi.fn();
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "cache"), Buffer.alloc(bytes));
      const used = (Date.now() - days * 24 * 60 * 60_000) / 1000;
      await utimes(directory, used, used);
      const preview = createPreviewService({
        workspaceRoot,
        cacheMaxMb,
        repository: {
          reconcilePreviewLeases: async () => undefined,
          listPreviewSessions: async () => [],
          listPreviewWorkspaces: async () => [
            { project_id: ref.projectId, full_ref: ref.branch, head_commit_sha: "sha" },
          ],
          listChangedWorkingFiles,
        } as never,
      });
      await preview.tick();
      await expect(stat(directory)).rejects.toMatchObject({ code: "ENOENT" });
      await preview.tick();
      expect(listChangedWorkingFiles).not.toHaveBeenCalled();
      await preview.stopAll();
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  },
);

it("rejects invalid preview disk budgets", () => {
  expect(() => createPreviewService({ repository: {} as never, cacheMaxMb: 0 })).toThrow(
    "Лимит дискового кеша",
  );
});
