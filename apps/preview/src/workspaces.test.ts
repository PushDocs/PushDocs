import { mkdir, mkdtemp, readFile, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { run } from "./service";
import { createWorkspaceManager, workspaceKey } from "./workspaces";

const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0)) await rm(root, { recursive: true, force: true });
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pushdocs-worktrees-"));
  temporary.push(root);
  const source = path.join(root, "source");
  await mkdir(path.join(source, "docs"), { recursive: true });
  const git = (args: string[]) =>
    run(["git", "-c", "user.name=Test", "-c", "user.email=test@example.test", ...args], {
      cwd: source,
      timeoutMs: 10_000,
    });
  await git(["init", "--quiet"]);
  await writeFile(path.join(source, "docs/page.md"), "first");
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", "first"]);
  const first = (await git(["rev-parse", "HEAD"])).trim();
  const commands: string[][] = [];
  const manager = createWorkspaceManager({
    root: path.join(root, "preview"),
    access: async () => ({ remote: source, env: process.env }),
    fetch: (operation) => operation(),
    run: (command, options) => {
      commands.push(command);
      return run(command, options).catch((error) => {
        throw new Error(`${JSON.stringify(command)}: ${String(error)}`);
      });
    },
  });
  await mkdir(path.join(root, "preview"));
  return { root, source, git, first, commands, manager };
}

it("pins the imported SHA and shares Git objects between isolated branch worktrees", async () => {
  const { source, git, first, commands, manager } = await fixture();
  await writeFile(path.join(source, "docs/page.md"), "remote moved");
  await git(["commit", "--quiet", "-am", "second"]);
  const ref = { projectId: "project", branch: "stable", headSha: first };
  const one = await manager.ensure(ref, new AbortController().signal);
  expect(await readFile(path.join(one.workspace, "docs/page.md"), "utf8")).toBe("first");
  const countFetch = () => commands.filter((command) => command.includes("fetch")).length;
  expect(countFetch()).toBe(1);
  await rename(source, `${source}-offline`);
  const two = await manager.ensure({ ...ref, branch: "docs/new" }, new AbortController().signal);
  expect(two.workspace).not.toBe(one.workspace);
  expect(countFetch()).toBe(1);
  const common = async (workspace: string) =>
    (
      await run(["git", "rev-parse", "--git-common-dir"], { cwd: workspace, timeoutMs: 10_000 })
    ).trim();
  expect(await common(one.workspace)).toBe(await common(two.workspace));
  await writeFile(path.join(one.workspace, "docs/page.md"), "draft");
  expect(await readFile(path.join(two.workspace, "docs/page.md"), "utf8")).toBe("first");
  await manager.ensure(ref, new AbortController().signal);
  expect(countFetch()).toBe(1);
});

it("updates the base without deleting dependencies or build caches and removes obsolete draft paths", async () => {
  const { source, git, first, manager } = await fixture();
  const ref = { projectId: "project", branch: "stable", headSha: first };
  const one = await manager.ensure(ref, new AbortController().signal);
  await mkdir(path.join(one.workspace, "node_modules"));
  await mkdir(path.join(one.workspace, ".docusaurus"));
  await writeFile(path.join(one.workspace, "node_modules/installed"), "dependencies");
  await writeFile(path.join(one.workspace, ".docusaurus/cache"), "cache");
  await writeFile(path.join(one.workspace, "docs/page.md"), "draft");
  await writeFile(path.join(one.workspace, "docs/new.md"), "new draft");
  await manager.saveCache(ref, {
    ...one.cache,
    appliedPaths: ["docs/page.md", "docs/new.md"],
    installed: true,
    installHash: "unchanged",
  });
  await writeFile(path.join(source, "docs/page.md"), "second");
  await git(["commit", "--quiet", "-am", "second"]);
  const headSha = (await git(["rev-parse", "HEAD"])).trim();
  const two = await manager.ensure({ ...ref, headSha }, new AbortController().signal);
  expect(two.workspace).toBe(one.workspace);
  expect(await readFile(path.join(two.workspace, "docs/page.md"), "utf8")).toBe("second");
  await expect(readFile(path.join(two.workspace, "docs/new.md"))).rejects.toThrow();
  expect(await readFile(path.join(two.workspace, "node_modules/installed"), "utf8")).toBe(
    "dependencies",
  );
  expect(await readFile(path.join(two.workspace, ".docusaurus/cache"), "utf8")).toBe("cache");
  expect(two.cache.installHash).toBe("unchanged");
  expect(two.cache.installed).toBe(true);
});

it("keeps different projects separate and prunes only inactive worktrees", async () => {
  const { first, manager } = await fixture();
  const ref = { projectId: "one", branch: "stable", headSha: first };
  const one = await manager.ensure(ref, new AbortController().signal);
  const two = await manager.ensure({ ...ref, projectId: "two" }, new AbortController().signal);
  expect(two.workspace).not.toBe(one.workspace);
  await manager.prune(new Set([workspaceKey(ref)]), Date.now() + 1000);
  expect(await readFile(path.join(one.workspace, "docs/page.md"), "utf8")).toBe("first");
  await expect(readFile(path.join(two.workspace, "docs/page.md"))).rejects.toThrow();
});

it("migrates a prepared legacy checkout without losing its installed dependencies or drafts", async () => {
  const { root, source, first, manager } = await fixture();
  const id = "00000000-0000-4000-8000-000000000001";
  const legacy = path.join(root, "preview", id);
  await run(["git", "clone", "--quiet", source, legacy], { cwd: root, timeoutMs: 10_000 });
  await run(["git", "checkout", "--quiet", "--detach"], { cwd: legacy, timeoutMs: 10_000 });
  const branches = (
    await run(["git", "for-each-ref", "--format=%(refname)", "refs/heads"], {
      cwd: legacy,
      timeoutMs: 10_000,
    })
  )
    .trim()
    .split("\n");
  for (const branch of branches)
    if (branch) await run(["git", "update-ref", "-d", branch], { cwd: legacy, timeoutMs: 10_000 });
  await mkdir(path.join(legacy, "node_modules"));
  await writeFile(path.join(legacy, "node_modules/installed"), "dependencies");
  await writeFile(path.join(legacy, "docs/page.md"), "draft");
  await writeFile(
    path.join(root, "preview", `${id}.json`),
    JSON.stringify({
      headSha: first,
      appliedPaths: ["docs/page.md"],
      installed: true,
      installHash: "old",
      uid: 11000,
    }),
  );
  const prepared = await manager.ensure(
    { projectId: "one", branch: "stable", headSha: first },
    new AbortController().signal,
    id,
  );
  expect(await readFile(path.join(prepared.workspace, "node_modules/installed"), "utf8")).toBe(
    "dependencies",
  );
  expect(await readFile(path.join(prepared.workspace, "docs/page.md"), "utf8")).toBe("draft");
  expect(prepared.cache.installed).toBe(true);
  expect(prepared.cache.appliedPaths).toEqual(["docs/page.md"]);
  expect(
    await run(["git", "rev-parse", "HEAD"], { cwd: prepared.workspace, timeoutMs: 10_000 }),
  ).toContain(first);
});

it("ignores an interrupted legacy checkout with no HEAD and prepares the imported commit", async () => {
  const { root, first, manager } = await fixture();
  const id = "00000000-0000-4000-8000-000000000002";
  const legacy = path.join(root, "preview", id);
  await mkdir(legacy);
  await run(["git", "init", "--quiet"], { cwd: legacy, timeoutMs: 10_000 });
  const prepared = await manager.ensure(
    { projectId: "one", branch: "docs/new", headSha: first },
    new AbortController().signal,
    id,
  );
  expect(await readFile(path.join(prepared.workspace, "docs/page.md"), "utf8")).toBe("first");
  expect(prepared.cache.installed).toBe(false);
});

it("evicts the least recently used inactive cache before its retention expires", async () => {
  const { first, manager, root } = await fixture();
  const ref = (branch: string) => ({ projectId: "one", branch, headSha: first });
  const refs = [ref("old"), ref("new"), ref("active")] as const;
  const trees = new Map<string, string>();
  const workspace = (branch: string) => {
    const directory = trees.get(branch);
    if (!directory) throw new Error("Missing fixture workspace");
    return directory;
  };
  for (const [index, ref] of refs.entries()) {
    const tree = await manager.ensure(ref, new AbortController().signal);
    await writeFile(path.join(tree.workspace, "payload"), Buffer.alloc(65536));
    const used = Date.now() - (3 - index) * 1000;
    await manager.saveCache(ref, { ...tree.cache, lastUsedAt: used });
    await utimes(
      path.join(root, "preview/metadata", `${workspaceKey(ref)}.json`),
      used / 1000,
      used / 1000,
    );
    trees.set(ref.branch, tree.workspace);
  }
  const baseline = await manager.prune(new Set(), 0, new Set(), Infinity);
  const result = await manager.prune(
    new Set([workspaceKey(refs[2])]),
    0,
    new Set(),
    baseline.bytes - 65536,
  );
  expect(result.removed).toEqual([workspaceKey(refs[0])]);
  expect(result.bytes).toBeLessThanOrEqual(baseline.bytes - 65536);
  expect(await manager.readCache(refs[0])).toBeNull();
  await expect(readFile(path.join(workspace("old"), "payload"))).rejects.toThrow();
  expect(await readFile(path.join(workspace("new"), "payload"))).toHaveLength(65536);
  expect(await readFile(path.join(workspace("active"), "payload"))).toHaveLength(65536);
  const rebuilt = await manager.ensure(refs[0], new AbortController().signal);
  expect(await readFile(path.join(rebuilt.workspace, "docs/page.md"), "utf8")).toBe("first");
});

it("preserves protected caches even when they exceed the entire budget", async () => {
  const { first, manager } = await fixture();
  const ref = { projectId: "one", branch: "active", headSha: first };
  const tree = await manager.ensure(ref, new AbortController().signal);
  const result = await manager.prune(new Set([workspaceKey(ref)]), Date.now() + 1000, new Set(), 1);
  expect(result.removed).toEqual([]);
  expect(result.bytes).toBeGreaterThan(1);
  expect(await readFile(path.join(tree.workspace, "docs/page.md"), "utf8")).toBe("first");
});

it("removes expired caches while retaining caches used within one day", async () => {
  const { first, manager, root } = await fixture();
  const now = Date.now();
  const ref = (days: number) => ({ projectId: "one", branch: `days-${days}`, headSha: first });
  const refs = [ref(2), ref(0.5)] as const;
  for (const [index, ref] of refs.entries()) {
    const tree = await manager.ensure(ref, new AbortController().signal);
    const used = now - (index === 0 ? 2 : 0.5) * 24 * 60 * 60_000;
    await manager.saveCache(ref, { ...tree.cache, lastUsedAt: used });
    await utimes(
      path.join(root, "preview/metadata", `${workspaceKey(ref)}.json`),
      used / 1000,
      used / 1000,
    );
  }
  const result = await manager.prune(new Set(), now - 24 * 60 * 60_000, new Set(), Infinity);
  expect(result.removed).toEqual([workspaceKey(refs[0])]);
  expect(await manager.readCache(refs[1])).not.toBeNull();
});

it("counts shared repositories and removes them after evicting their final worktree", async () => {
  const { first, manager, root } = await fixture();
  await manager.ensure(
    { projectId: "one", branch: "old", headSha: first },
    new AbortController().signal,
  );
  const result = await manager.prune(new Set(), 0, new Set(), 1);
  expect(result.removed).toHaveLength(1);
  const { readdir } = await import("node:fs/promises");
  expect(await readdir(path.join(root, "preview/repositories"))).toEqual([]);
});

it("evicts interrupted and legacy checkouts without following symlinks outside the cache", async () => {
  const { manager, root } = await fixture();
  await manager.initialize();
  const orphan = path.join(root, "preview/worktrees", "a".repeat(64));
  const legacyId = "00000000-0000-4000-8000-000000000099";
  const legacy = path.join(root, "preview", legacyId);
  const outside = path.join(root, "outside");
  await mkdir(orphan);
  await mkdir(legacy);
  await mkdir(outside);
  await writeFile(path.join(outside, "data"), Buffer.alloc(1024 * 1024));
  await symlink(outside, path.join(orphan, "linked"));
  await writeFile(path.join(legacy, "payload"), Buffer.alloc(65536));
  const baseline = await manager.prune(new Set(), 0, new Set([legacyId]), Infinity);
  expect(baseline.bytes).toBeLessThan(1024 * 1024);
  const result = await manager.prune(new Set(), 0, new Set(), 1);
  expect(result.removed.sort()).toEqual([legacyId, "a".repeat(64)].sort());
  expect(await readFile(path.join(outside, "data"))).toHaveLength(1024 * 1024);
});

it("reports cache disk usage and expiry and removes only the requested branch worktree", async () => {
  const { first, manager } = await fixture();
  const ref = { projectId: "project", branch: "stable", headSha: first };
  const firstWorkspace = await manager.ensure(ref, new AbortController().signal);
  const other = await manager.ensure({ ...ref, branch: "other" }, new AbortController().signal);
  const cache = await manager.readCache(ref);
  if (!cache) throw new Error("Missing cache");
  const originalCreatedAt = cache.createdAt;
  await manager.saveCache(ref, { ...cache, lastUsedAt: Date.now() });
  expect((await manager.readCache(ref))?.createdAt).toBe(originalCreatedAt);
  const inventory = await manager.inventory();
  expect(inventory).toHaveLength(2);
  const row = inventory.find((item) => item.branch === "stable");
  expect(row?.diskBytes).toBeGreaterThan(0);
  expect(row?.expiresAt.getTime()).toBeGreaterThan(Date.now() + 23 * 60 * 60_000);
  await manager.remove(ref);
  expect(await manager.readCache(ref)).toBeNull();
  await expect(readFile(path.join(firstWorkspace.workspace, "docs/page.md"))).rejects.toThrow();
  expect(await readFile(path.join(other.workspace, "docs/page.md"), "utf8")).toBe("first");
  expect((await manager.inventory()).map((item) => item.branch)).toEqual(["other"]);
});
