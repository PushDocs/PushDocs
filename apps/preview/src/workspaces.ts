import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

export type WorkspaceBranch = { projectId: string; branch: string; headSha: string };
export type WorkspaceCache = {
  createdAt?: number;
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
  isActive?: (key: string) => boolean;
  quiesce?: (uid: number) => Promise<void>;
  hasRuntimeProcesses?: (uid: number) => Promise<boolean>;
}) {
  const repositories = path.join(options.root, "repositories");
  const worktrees = path.join(options.root, "worktrees");
  const metadata = path.join(options.root, "metadata");
  const locks = new Map<string, Promise<unknown>>();
  const runtimeLocks = new Map<number, Promise<unknown>>();
  let initialization: Promise<void> | undefined;
  const repositoryPath = (projectId: string) => path.join(repositories, `${digest(projectId)}.git`);
  const workspacePath = (branch: Pick<WorkspaceBranch, "projectId" | "branch">) =>
    path.join(worktrees, workspaceKey(branch));
  const worktreeGitDir = (branch: Pick<WorkspaceBranch, "projectId" | "branch">) =>
    path.join(repositoryPath(branch.projectId), "worktrees", workspaceKey(branch));
  function gitLocation(branch: Pick<WorkspaceBranch, "projectId" | "branch">, cwd: string) {
    return cwd === workspacePath(branch)
      ? [`--git-dir=${worktreeGitDir(branch)}`, `--work-tree=${cwd}`]
      : [`--git-dir=${repositoryPath(branch.projectId)}`];
  }
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
      JSON.stringify({
        ...cache,
        createdAt: cache.createdAt ?? (await readCache(branch))?.createdAt ?? Date.now(),
        projectId: branch.projectId,
        branch: branch.branch,
      }),
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

  async function lockedRuntime<T>(uid: number, operation: () => Promise<T>): Promise<T> {
    const previous = runtimeLocks.get(uid) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    runtimeLocks.set(uid, current);
    try {
      return await current;
    } finally {
      if (runtimeLocks.get(uid) === current) runtimeLocks.delete(uid);
    }
  }

  async function quiesceWorkspace(uid: number, workspace: string) {
    return lockedRuntime(uid, () => quiesceAssignedWorkspace(uid, workspace));
  }

  async function quiesceAssignedWorkspace(uid: number, workspace: string) {
    if (!options.quiesce) return true;
    if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Недопустимый UID предпросмотра");
    // A container restart leaves old cache/assignment receipts but no site processes.
    // This also supports legacy receipts that recorded only the repository.
    if (options.hasRuntimeProcesses && !(await options.hasRuntimeProcesses(uid))) return true;
    let assignedWorkspace: unknown;
    try {
      assignedWorkspace = JSON.parse(
        await readFile(path.join(metadata, `runtime-${uid}.json`), "utf8"),
      ).workspace;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (assignedWorkspace === workspace) {
      await options.quiesce(uid);
      return true;
    }
    if (
      typeof assignedWorkspace !== "string" ||
      path.dirname(assignedWorkspace) !== worktrees ||
      !/^[a-f0-9]{64}$/.test(path.basename(assignedWorkspace))
    )
      throw new Error("Не удалось подтвердить рабочую папку живого UID предпросмотра");
    // grantReadAccess revokes the former workspace before assigning this UID elsewhere.
    // Never kill its new site's processes. Refuse preparation if that revocation is absent.
    if (process.platform === "linux" && process.getuid?.() === 0) {
      const info = await lstat(workspace);
      if (!info.isDirectory() || info.uid !== 0 || (info.mode & 0o077) !== 0)
        throw new Error("Старая рабочая папка доступна переназначенному UID предпросмотра");
    }
    return false;
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
      let legacyCanReuseCache = true;
      if (cache?.uid !== undefined) await quiesceWorkspace(cache.uid, workspace);
      // Legacy Git metadata is untrusted. A controller-owned receipt may preserve a
      // same-base legacy file tree, but all Git objects and metadata come from the remote.
      if (cache?.headSha === branch.headSha && (await exists(worktreeGitDir(branch))))
        return { workspace, cache };

      const { remote, env } = await options.access(branch.projectId);
      const git = (args: string[], cwd = repository, maxOutput?: number) =>
        options.run(
          ["git", ...gitLocation(branch, cwd), "-c", "core.hooksPath=/dev/null", ...args],
          {
            cwd,
            env,
            signal,
            timeoutMs: 10 * 60_000,
            maxOutput,
          },
        );
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
      if (!(await exists(worktreeGitDir(branch)))) {
        await git(["worktree", "add", "--detach", "--no-checkout", workspace, branch.headSha]);
        await chmod(workspace, 0o700);
        let legacyCache: WorkspaceCache | undefined;
        if (legacyWorkspace && (await exists(legacyWorkspace))) {
          try {
            legacyCache = JSON.parse(
              await readFile(path.join(options.root, `${legacySessionId}.json`), "utf8"),
            ) as WorkspaceCache;
          } catch {
            /* No complete controller receipt: rebuild from the imported commit. */
          }
        }
        if (legacyWorkspace && legacyCache?.uid !== undefined)
          legacyCanReuseCache = await quiesceWorkspace(legacyCache.uid, legacyWorkspace);
        if (
          legacyCanReuseCache &&
          legacyWorkspace &&
          legacyCache?.headSha === branch.headSha &&
          Array.isArray(legacyCache.appliedPaths) &&
          legacyCache.appliedPaths.every((filename) => typeof filename === "string")
        ) {
          await rm(path.join(legacyWorkspace, ".git"), { recursive: true, force: true });
          await rename(path.join(workspace, ".git"), path.join(legacyWorkspace, ".git"));
          await rm(workspace, { recursive: true });
          await rename(legacyWorkspace, workspace);
          await chmod(workspace, 0o700);
          await git(["read-tree", branch.headSha], workspace);
          cache = { ...legacyCache, legacyWorkspace, lastUsedAt: Date.now() };
          await saveCache(branch, cache);
          return { workspace, cache };
        }
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
      // Without a matching receipt, keep dependency caches but rebuild tracked files
      // from the imported commit. Drafts will be reapplied from PostgreSQL by the service.
      if (legacyWorkspace && legacyCanReuseCache) {
        for (const name of ["node_modules", ".package-cache", ".docusaurus", ".next"]) {
          const from = path.join(legacyWorkspace, name);
          const info = await lstat(from).catch((error) => {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
            throw error;
          });
          if (info?.isDirectory() && !(await exists(path.join(workspace, name))))
            await rename(from, path.join(workspace, name));
        }
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
    if (path.dirname(workspace) !== worktrees || !/^[a-f0-9]{64}$/.test(path.basename(workspace)))
      throw new Error("Неизвестная рабочая папка предпросмотра");
    const cache = JSON.parse(
      await readFile(path.join(metadata, `${path.basename(workspace)}.json`), "utf8"),
    ) as WorkspaceBranch;
    if (workspacePath(cache) !== workspace)
      throw new Error("Рабочая папка не совпадает с метаданными");
    const location = gitLocation(cache, workspace);
    try {
      await options.run(
        [
          "git",
          ...location,
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
        await options.run(["git", ...location, "cat-file", "-e", `${headSha ?? "HEAD"}:${safe}`], {
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
    return lockedRuntime(uid, () => grantRuntimeReadAccess(branch, uid));
  }

  async function grantRuntimeReadAccess(branch: WorkspaceBranch, uid: number) {
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

  async function diskBytes(directory: string): Promise<number> {
    try {
      const info = await lstat(directory);
      let bytes = info.blocks * 512;
      if (info.isDirectory())
        for (const entry of await readdir(directory))
          bytes += await diskBytes(path.join(directory, entry));
      return bytes;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw error;
    }
  }

  async function inventory() {
    await initialize();
    const rows = [];
    for (const filename of await readdir(metadata)) {
      if (!/^[a-f0-9]{64}\.json$/.test(filename)) continue;
      const cache = JSON.parse(
        await readFile(path.join(metadata, filename), "utf8"),
      ) as WorkspaceCache & WorkspaceBranch;
      if (typeof cache.projectId !== "string" || typeof cache.branch !== "string") continue;
      const info = await stat(path.join(metadata, filename));
      rows.push({
        projectId: cache.projectId,
        branch: cache.branch,
        createdAt: new Date(cache.createdAt ?? info.birthtimeMs),
        diskBytes: await diskBytes(workspacePath(cache)),
        expiresAt: new Date(Math.max(cache.lastUsedAt, info.mtimeMs) + 24 * 60 * 60_000),
      });
    }
    return rows;
  }

  async function remove(branch: Pick<WorkspaceBranch, "projectId" | "branch">) {
    await initialize();
    await locked(branch.projectId, async () => {
      const workspace = workspacePath(branch);
      if (await exists(path.join(workspace, ".git"))) {
        await options.run(
          [
            "git",
            "-C",
            repositoryPath(branch.projectId),
            "worktree",
            "remove",
            "--force",
            workspace,
          ],
          { cwd: options.root, timeoutMs: 120_000 },
        );
      } else await rm(workspace, { recursive: true, force: true });
      await rm(cachePath(branch), { force: true });
    });
  }

  async function prune(
    active: Set<string>,
    cutoff: number,
    protectedLegacyIds = new Set<string>(),
    maxBytes = 8192 * 1024 * 1024,
  ) {
    await initialize();
    const candidates: Array<{
      key: string;
      directory: string;
      metadata?: string;
      repository?: string;
      lastUsedAt: number;
      legacy?: boolean;
    }> = [];
    const registered = new Map<string, string>();
    for (const entry of await readdir(repositories, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}\.git$/.test(entry.name)) continue;
      const repository = path.join(repositories, entry.name);
      const trees = await options.run(
        ["git", "-C", repository, "worktree", "list", "--porcelain"],
        {
          cwd: options.root,
          timeoutMs: 30_000,
        },
      );
      for (const match of trees.matchAll(/^worktree (.+)$/gm))
        if (match[1]) registered.set(match[1], repository);
    }
    for (const entry of await readdir(worktrees, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9]{64}$/.test(entry.name)) continue;
      const directory = path.join(worktrees, entry.name);
      const filename = path.join(metadata, `${entry.name}.json`);
      let lastUsedAt = (await stat(directory)).mtimeMs;
      if (await exists(filename)) {
        const cache = JSON.parse(await readFile(filename, "utf8")) as WorkspaceCache;
        lastUsedAt = Math.max(cache.lastUsedAt, (await stat(filename)).mtimeMs);
      }
      candidates.push({
        key: entry.name,
        directory,
        metadata: filename,
        repository: registered.get(await realpath(directory)),
        lastUsedAt,
      });
    }
    for (const entry of await readdir(options.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !/^[a-f0-9-]{36}$/.test(entry.name)) continue;
      const directory = path.join(options.root, entry.name);
      const filename = path.join(options.root, `${entry.name}.json`);
      const cacheTime = await stat(filename)
        .then((value) => value.mtimeMs)
        .catch((error) => {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          return 0;
        });
      candidates.push({
        key: entry.name,
        directory,
        metadata: filename,
        lastUsedAt: Math.max(cacheTime, (await stat(directory)).mtimeMs),
        legacy: true,
      });
    }
    let bytes = await diskBytes(options.root);
    const removed: string[] = [];
    for (const candidate of candidates.sort((a, b) => a.lastUsedAt - b.lastUsedAt)) {
      if (
        (candidate.lastUsedAt > cutoff && bytes <= maxBytes) ||
        active.has(candidate.key) ||
        options.isActive?.(candidate.key) ||
        (candidate.legacy && protectedLegacyIds.has(candidate.key)) ||
        [...locks.keys()].some((projectId) => repositoryPath(projectId) === candidate.repository)
      )
        continue;
      const size = await diskBytes(candidate.directory);
      if (candidate.repository)
        await options.run(
          ["git", "-C", candidate.repository, "worktree", "remove", "--force", candidate.directory],
          { cwd: options.root, timeoutMs: 120_000 },
        );
      else await rm(candidate.directory, { recursive: true, force: true });
      if (candidate.metadata) await rm(candidate.metadata, { force: true });
      bytes -= size;
      removed.push(candidate.key);
    }
    // Shared Git objects count towards the budget too. Keep repositories with retained worktrees.
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
      if (retained.has(repository)) continue;
      if ((await stat(repository)).mtimeMs > cutoff && bytes <= maxBytes) continue;
      const trees = await options.run(
        ["git", "-C", repository, "worktree", "list", "--porcelain"],
        {
          cwd: options.root,
          timeoutMs: 30_000,
        },
      );
      if ((trees.match(/^worktree /gm) ?? []).length === 1) {
        const size = await diskBytes(repository);
        await rm(repository, { recursive: true, force: true });
        bytes -= size;
      }
    }
    return { bytes: await diskBytes(options.root), removed };
  }

  return {
    ensure,
    grantReadAccess,
    initialize,
    inventory,
    remove,
    prune,
    readCache,
    restore,
    saveCache,
    workspacePath,
  };
}
