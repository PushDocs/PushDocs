import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
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
