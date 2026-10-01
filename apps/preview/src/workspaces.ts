import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type WorkspaceBranch = { projectId: string; branch: string; headSha: string };
export type WorkspaceCache = {
  appliedPaths: string[];
  headSha: string;
  installHash?: string;
  installed: boolean;
  uid?: number;
  gid?: number;
  legacyWorkspace?: string;
  lastUsedAt: number;
  revision?: number;
};
export type GitAccess = { remote: string; env: NodeJS.ProcessEnv };
type Runner = (
  command: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
    timeoutMs: number;
    maxOutput?: number;
  },
) => Promise<string>;

const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export const workspaceKey = (branch: Pick<WorkspaceBranch, "projectId" | "branch">) =>
  digest(`${branch.projectId}\0${branch.branch}`);

export function leafCheckoutDirectories(treeOutput: string): string[] {
  const directories = treeOutput.split("\0").filter(Boolean);
  return directories
    .filter((directory) => !directories.some((other) => other.startsWith(`${directory}/`)))
    .sort();
}

export async function atomicWrite(filename: string, content: string | Buffer, mode = 0o644) {
  await mkdir(path.dirname(filename), { recursive: true, mode: 0o755 });
  const temporary = path.join(path.dirname(filename), `.pushdocs-${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, content, { mode, flag: "wx" });
    await rename(temporary, filename);
  } finally {
    await rm(temporary, { force: true });
  }
}

export function createWorkspaceManager(options: {
  root: string;
  run: Runner;
  access: (projectId: string) => Promise<GitAccess>;
  fetch: (operation: () => Promise<string>) => Promise<string>;
}) {
  const repositories = path.join(options.root, "repositories");
  const worktrees = path.join(options.root, "worktrees");
  const metadata = path.join(options.root, "metadata");
  const locks = new Map<string, Promise<unknown>>();
  let initialization: Promise<void> | undefined;
  const repositoryPath = (projectId: string) => path.join(repositories, `${digest(projectId)}.git`);
  const workspacePath = (branch: Pick<WorkspaceBranch, "projectId" | "branch">) =>
    path.join(worktrees, workspaceKey(branch));
  const cachePath = (branch: Pick<WorkspaceBranch, "projectId" | "branch">) =>
    path.join(metadata, `${workspaceKey(branch)}.json`);

  function initialize() {
    if (initialization) return initialization;
    initialization = (async () => {
      // Webpack snapshots ancestor directories. Listing opaque workspace names is allowed;
      // each workspace's contents, repositories and metadata remain private.
      await mkdir(options.root, { recursive: true, mode: 0o755 });
      await chmod(options.root, 0o755);
      await mkdir(worktrees, { recursive: true, mode: 0o755 });
      await chmod(worktrees, 0o755);
      await mkdir(repositories, { recursive: true, mode: 0o711 });
      await mkdir(metadata, { recursive: true, mode: 0o700 });
      if (process.platform === "linux" && process.getuid?.() === 0) {
        // A previous container's runtime users no longer own access to dormant workspaces.
        for (const directory of [options.root, worktrees]) {
          for (const entry of await readdir(directory, { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^(?:[a-f0-9]{64}|[a-f0-9-]{36})$/.test(entry.name))
              continue;
            const workspace = path.join(directory, entry.name);
            await options.run(["chown", "0:0", workspace], {
              cwd: options.root,
              timeoutMs: 30_000,
            });
            await chmod(workspace, 0o700);
          }
        }
      }
    })();
    return initialization;
  }

  async function readCache(
    branch: Pick<WorkspaceBranch, "projectId" | "branch">,
  ): Promise<WorkspaceCache | null> {
    try {
      const cache = JSON.parse(await readFile(cachePath(branch), "utf8")) as WorkspaceCache;
      if (
        typeof cache.headSha !== "string" ||
        !Array.isArray(cache.appliedPaths) ||
        !cache.appliedPaths.every((item) => typeof item === "string") ||
        typeof cache.installed !== "boolean"
      )
        return null;
      return cache;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" || error instanceof SyntaxError)
        return null;
      throw error;
    }
  }

  async function saveCache(
    branch: Pick<WorkspaceBranch, "projectId" | "branch">,
    cache: WorkspaceCache,
  ) {
    await atomicWrite(
      cachePath(branch),
      JSON.stringify({ ...cache, projectId: branch.projectId, branch: branch.branch }),
      0o600,
    );
  }

  async function exists(filename: string) {
    try {
      await lstat(filename);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
      throw error;
    }
  }

  async function locked<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = locks.get(projectId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    locks.set(projectId, current);
    try {
      return await current;
    } finally {
      if (locks.get(projectId) === current) locks.delete(projectId);
    }
  }

  async function ensure(branch: WorkspaceBranch, signal: AbortSignal, legacySessionId?: string) {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(branch.headSha))
      throw new Error("Коммит ветки предпросмотра настроен неверно");
    return locked(branch.projectId, async () => {
      signal.throwIfAborted();
      await initialize();
      const repository = repositoryPath(branch.projectId);
      const workspace = workspacePath(branch);
      const legacyWorkspace =
        legacySessionId && /^[a-f0-9-]{36}$/.test(legacySessionId)
          ? path.join(options.root, legacySessionId)
          : undefined;
      let cache = await readCache(branch);
      let migrated = false;
      let legacyHead: string | undefined;
      if (legacyWorkspace && (await exists(path.join(legacyWorkspace, ".git")))) {
        try {
          legacyHead = (
            await options.run(["git", "-C", legacyWorkspace, "rev-parse", "--verify", "HEAD"], {
              cwd: options.root,
              signal,
              timeoutMs: 30_000,
            })
          ).trim();
        } catch {
          signal.throwIfAborted();
          // A failed download may leave an initialized repository with no checked-out commit.
          legacyHead = undefined;
        }
      }
      // Preserve existing node_modules and build caches on upgrades from session-based checkouts.
      if (!(await exists(workspace)) && legacyWorkspace && legacyHead) {
        if (process.platform === "linux" && process.getuid?.() === 0)
          // upload-pack deliberately strips caller Git configuration. Own the source Git metadata
          // as controller state before copying it; leave installed dependencies untouched.
          await options.run(["chown", "-R", "0:0", path.join(legacyWorkspace, ".git")], {
            cwd: options.root,
            signal,
            timeoutMs: 120_000,
          });
        if (!(await exists(repository))) {
          await options.run(
            [
              "git",
              "-c",
              `safe.directory=${legacyWorkspace}`,
              "-c",
              `safe.directory=${path.join(legacyWorkspace, ".git")}`,
              "clone",
              "--bare",
              "--no-hardlinks",
              "--quiet",
              legacyWorkspace,
              repository,
            ],
            {
              cwd: options.root,
              signal,
              timeoutMs: 120_000,
            },
          );
          await chmod(repository, 0o700);
        } else {
          await options.run(
            [
              "git",
              "-c",
              `safe.directory=${legacyWorkspace}`,
              "-c",
              `safe.directory=${path.join(legacyWorkspace, ".git")}`,
              "-C",
              repository,
              "fetch",
              "--quiet",
              "--update-shallow",
              legacyWorkspace,
              "HEAD",
            ],
            {
              cwd: options.root,
              signal,
              timeoutMs: 120_000,
            },
          );
        }
        try {
          cache = JSON.parse(
            await readFile(path.join(options.root, `${legacySessionId}.json`), "utf8"),
          ) as WorkspaceCache;
        } catch {
          cache = null;
        }
        await options.run(
          [
            "git",
            "-C",
            repository,
            "worktree",
            "add",
            "--detach",
            "--no-checkout",
            workspace,
            legacyHead,
          ],
          {
            cwd: options.root,
            signal,
            timeoutMs: 30_000,
          },
        );
        // The new worktree contains only its Git pointer. Move it into the prepared legacy folder.
        await rm(path.join(legacyWorkspace, ".git"), { recursive: true, force: true });
        await rename(path.join(workspace, ".git"), path.join(legacyWorkspace, ".git"));
        await rm(workspace, { recursive: true });
        await rename(legacyWorkspace, workspace);
        await chmod(workspace, 0o700);
        await options.run(["git", "-C", repository, "worktree", "repair", workspace], {
          cwd: options.root,
          signal,
          timeoutMs: 30_000,
        });
        // Populate the per-worktree index without rewriting the working files.
        await options.run(["git", "-C", workspace, "read-tree", legacyHead], {
          cwd: options.root,
          signal,
          timeoutMs: 30_000,
        });
        cache = {
          ...cache,
          appliedPaths: cache?.appliedPaths ?? [],
          installed: cache?.installed ?? false,
          headSha: legacyHead,
          legacyWorkspace,
          lastUsedAt: Date.now(),
        };
        await saveCache(branch, cache);
        await rm(path.join(options.root, `${legacySessionId}.json`), { force: true });
        migrated = true;
      }
      if (
        !migrated &&
        cache?.headSha === branch.headSha &&
        (await exists(path.join(workspace, ".git")))
      )
        return { workspace, cache };

      const { remote, env } = await options.access(branch.projectId);
      const git = (args: string[], cwd = repository, maxOutput?: number) =>
        options.run(["git", "-c", "core.hooksPath=/dev/null", ...args], {
          cwd,
          env,
          signal,
          timeoutMs: 10 * 60_000,
          maxOutput,
        });
      if (!(await exists(repository))) {
        await mkdir(repository, { mode: 0o700 });
        await git(["init", "--bare", "--quiet"]);
      }
      await git(["config", "extensions.worktreeConfig", "true"]);
      await git(["config", "--worktree", "core.bare", "true"]);
      await git(["config", "--local", "core.bare", "false"]);
      await git(["config", "core.hooksPath", "/dev/null"]);
      await git(["config", "remote.origin.url", remote]);
      await git(["config", "remote.origin.promisor", "true"]);
      await git(["config", "remote.origin.partialclonefilter", "blob:none"]);
      if (migrated && cache) {
        await git(["update-ref", `refs/pushdocs/commits/${cache.headSha}`, cache.headSha]);
        if (cache.headSha === branch.headSha) return { workspace, cache };
      }
      try {
        await git(["show-ref", "--verify", "--quiet", `refs/pushdocs/commits/${branch.headSha}`]);
      } catch {
        // Fetch the imported SHA, never a possibly newer tip of the remote branch.
        await options.fetch(() =>
          git([
            "fetch",
            "--quiet",
            "--no-tags",
            "--depth=1",
            "--filter=blob:none",
            "origin",
            `+${branch.headSha}:refs/pushdocs/commits/${branch.headSha}`,
          ]),
        );
      }
      if (!(await exists(path.join(workspace, ".git")))) {
        await git(["worktree", "add", "--detach", "--no-checkout", workspace, branch.headSha]);
        await chmod(workspace, 0o700);
        await git(["sparse-checkout", "set", "--cone", "--no-sparse-index"], workspace);
        await options.fetch(() =>
          git(["checkout", "--quiet", "--detach", branch.headSha], workspace),
        );
        const directories = leafCheckoutDirectories(
          await git(
            ["ls-tree", "-r", "-d", "--name-only", "-z", branch.headSha],
            repository,
            10_000_000,
          ),
        );
        for (const directory of directories)
          await options.fetch(() => git(["sparse-checkout", "add", "--", directory], workspace));
        await options.fetch(() => git(["sparse-checkout", "disable"], workspace));
      } else {
        // Drafts are durable in PostgreSQL. Restore the old overlay before changing its base.
        for (const filename of cache?.appliedPaths ?? [])
          await restore(workspace, filename, cache?.headSha);
        await options.fetch(() =>
          git(["checkout", "--force", "--quiet", "--detach", branch.headSha], workspace),
        );
        await options.fetch(() => git(["sparse-checkout", "disable"], workspace));
      }
      cache = {
        ...cache,
        headSha: branch.headSha,
        appliedPaths: [],
        revision: undefined,
        installed: cache?.installed ?? false,
        uid: undefined,
        gid: undefined,
        lastUsedAt: Date.now(),
      };
      await saveCache(branch, cache);
      return { workspace, cache };
    });
  }

  async function restore(workspace: string, filename: string, headSha?: string) {
    const { safePath } = await import("@pushdocs/content");
    const safe = safePath(filename);
    try {
      await options.run(
        [
          "git",
          "-c",
          "core.hooksPath=/dev/null",
          "restore",
          "--source",
          headSha ?? "HEAD",
          "--worktree",
          "--",
          safe,
        ],
        {
          cwd: workspace,
          timeoutMs: 30_000,
        },
      );
    } catch (error) {
      // Only remove paths that are absent from the base; other Git failures must remain visible.
      try {
        await options.run(["git", "cat-file", "-e", `${headSha ?? "HEAD"}:${safe}`], {
          cwd: workspace,
          timeoutMs: 30_000,
        });
      } catch {
        await rm(path.join(workspace, safe), { recursive: true, force: true });
        return;
      }
      throw error;
    }
  }

  async function grantReadAccess(branch: WorkspaceBranch, uid: number) {
    if (process.platform !== "linux") return;
    const repository = repositoryPath(branch.projectId);
    const userCache = path.join(metadata, `runtime-${uid}.json`);
    let previous: string | undefined;
    let previousWorkspace: string | undefined;
    try {
      const previousUser = JSON.parse(await readFile(userCache, "utf8"));
      previous = previousUser.repository;
      previousWorkspace = previousUser.workspace;
    } catch {
      /* First use of this UID. */
    }
    const workspace = workspacePath(branch);
    if (
      previousWorkspace &&
      previousWorkspace !== workspace &&
      path.dirname(previousWorkspace) === worktrees &&
      (await exists(previousWorkspace))
    ) {
      await options.run(["chown", "0:0", previousWorkspace], {
        cwd: options.root,
        timeoutMs: 30_000,
      });
      await chmod(previousWorkspace, 0o700);
    }
    if (
      previous &&
      previous !== repository &&
      path.dirname(previous) === repositories &&
      (await exists(previous))
    ) {
      await options.run(["setfacl", "-R", "-x", `u:${uid}`, previous], {
        cwd: options.root,
        timeoutMs: 120_000,
      });
      await options.run(
        ["find", previous, "-type", "d", "-exec", "setfacl", "-x", `d:u:${uid}`, "{}", "+"],
        { cwd: options.root, timeoutMs: 120_000 },
      );
    }
    // Git-based site plugins can read their project's objects, but cannot write shared Git state.
    await options.run(["setfacl", "-R", "-m", `u:${uid}:r-X`, repository], {
      cwd: options.root,
      timeoutMs: 120_000,
    });
    await options.run(
      ["find", repository, "-type", "d", "-exec", "setfacl", "-m", `d:u:${uid}:r-x`, "{}", "+"],
      { cwd: options.root, timeoutMs: 120_000 },
    );
    await atomicWrite(userCache, JSON.stringify({ repository, workspace }), 0o600);
  }

  async function prune(
    active: Set<string>,
    cutoff: number,
    protectedLegacyIds = new Set<string>(),
  ) {
    await initialize();
    for (const filename of await readdir(metadata)) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename) || active.has(filename.slice(0, -5))) continue;
      const cache = JSON.parse(
        await readFile(path.join(metadata, filename), "utf8"),
      ) as WorkspaceCache & WorkspaceBranch;
      if (cache.lastUsedAt > cutoff || (await stat(path.join(metadata, filename))).mtimeMs > cutoff)
        continue;
      const workspace = workspacePath(cache);
      if (await exists(workspace))
        await options.run(
          [
            "git",
            "-C",
            repositoryPath(cache.projectId),
            "worktree",
            "remove",
            "--force",
            workspace,
          ],
          { cwd: options.root, timeoutMs: 120_000 },
        );
      await rm(path.join(metadata, filename), { force: true });
    }
    // Remove old session-based caches that were never migrated (including interrupted checkouts).
    for (const entry of await readdir(options.root, { withFileTypes: true })) {
      if (
        !entry.isDirectory() ||
        !/^[a-f0-9-]{36}$/.test(entry.name) ||
        protectedLegacyIds.has(entry.name)
      )
        continue;
      const directory = path.join(options.root, entry.name);
      const filename = path.join(options.root, `${entry.name}.json`);
      const cacheTime = await stat(filename)
        .then((value) => value.mtimeMs)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return 0;
        });
      if (Math.max(cacheTime, (await stat(directory)).mtimeMs) > cutoff) continue;
      await rm(directory, { recursive: true, force: true });
      await rm(filename, { force: true });
    }
    const retained = new Set([...locks.keys()].map(repositoryPath));
    for (const filename of await readdir(metadata)) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
      const cache = JSON.parse(
        await readFile(path.join(metadata, filename), "utf8"),
      ) as WorkspaceBranch;
      retained.add(repositoryPath(cache.projectId));
    }
    for (const entry of await readdir(repositories, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}\.git$/.test(entry.name)) continue;
      const repository = path.join(repositories, entry.name);
      if (retained.has(repository) || (await stat(repository)).mtimeMs > cutoff) continue;
      const trees = await options.run(
        ["git", "-C", repository, "worktree", "list", "--porcelain"],
        { cwd: options.root, timeoutMs: 30_000 },
      );
      if ((trees.match(/^worktree /gm) ?? []).length === 1)
        await rm(repository, { recursive: true, force: true });
    }
  }

  return {
    ensure,
    grantReadAccess,
    initialize,
    prune,
    readCache,
    restore,
    saveCache,
    workspacePath,
  };
}
