import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import {
  chmod,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  privateTreeCleanupIdentity,
  privateTreeCopyBudget,
  privateTreeOperation,
} from "./private-filesystem";

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
  gitDirectory?: string;
  exposed?: boolean;
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

type RetirementReceipt = {
  directory: string;
  gitDir?: string;
  exposed: boolean;
};

const opaqueWorkspaceIdPattern = "[a-f0-9-]{36}";
const opaqueWorkspaceName = new RegExp(`^${opaqueWorkspaceIdPattern}$`);
const retiredReceiptPrefix = "retired-";
const retiredReceiptName = new RegExp(
  `^${retiredReceiptPrefix}(${opaqueWorkspaceIdPattern})\\.json$`,
);
const repositoryName = /^[a-f0-9]{64}\.git$/;

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
  copyBudgetBytes?: number;
}) {
  const repositories = path.join(options.root, "repositories");
  const worktrees = path.join(options.root, "worktrees");
  const metadata = path.join(options.root, "metadata");
  const preparing = path.join(options.root, "preparing");
  const retired = path.join(options.root, "retired");
  type Pending = {
    branch: WorkspaceBranch;
    workspace: string;
    source?: string;
    old: WorkspaceCache | null;
    cache: WorkspaceCache;
  };
  const pending = new Map<string, Pending>();
  const locks = new Map<string, Promise<unknown>>();
  const runtimeLocks = new Map<number, Promise<unknown>>();
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
      await mkdir(preparing, { recursive: true, mode: 0o700 });
      await chmod(preparing, 0o700);
      await mkdir(retired, { recursive: true, mode: 0o711 });
      await chmod(retired, 0o711);
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
    const stage = pending.get(workspaceKey(branch));
    if (stage) return stage.cache;
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
    const stage = pending.get(workspaceKey(branch));
    if (stage) {
      stage.cache = cache;
      return;
    }
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

  async function ensure(branch: WorkspaceBranch, signal: AbortSignal, legacySessionId?: string) {
    if (!/^[a-f0-9]{40}(?:[a-f0-9]{24})?$/.test(branch.headSha))
      throw new Error("Коммит ветки предпросмотра настроен неверно");
    return locked(branch.projectId, async () => {
      signal.throwIfAborted();
      await initialize();
      const existing = pending.get(workspaceKey(branch));
      if (existing) return { workspace: existing.workspace, cache: existing.cache };
      const old = await readCache(branch);
      const stable = workspacePath(branch);
      const legacy =
        legacySessionId && opaqueWorkspaceName.test(legacySessionId)
          ? path.join(options.root, legacySessionId)
          : undefined;
      const source = (await exists(stable))
        ? stable
        : legacy && (await exists(legacy))
          ? legacy
          : undefined;
      let sourceCache = old;
      if (!sourceCache && source === legacy) {
        try {
          sourceCache = JSON.parse(
            await readFile(path.join(options.root, `${legacySessionId}.json`), "utf8"),
          ) as WorkspaceCache;
        } catch {
          /* Rebuild tracked files from Git and durable PostgreSQL drafts. */
        }
      }
      const repository = repositoryPath(branch.projectId);
      const { remote, env } = await options.access(branch.projectId);
      const git = (args: string[], maxOutput?: number) =>
        options.run(["git", `--git-dir=${repository}`, "-c", "core.hooksPath=/dev/null", ...args], {
          cwd: options.root,
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
      try {
        await git(["show-ref", "--verify", "--quiet", `refs/pushdocs/commits/${branch.headSha}`]);
      } catch {
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
      const gitDirectory = randomUUID();
      const workspace = path.join(preparing, gitDirectory);
      await mkdir(workspace, { mode: 0o700 });
      const provisional: WorkspaceCache = {
        ...sourceCache,
        headSha: branch.headSha,
        gitDirectory,
        appliedPaths: [],
        installed: false,
        exposed: false,
        lastUsedAt: Date.now(),
      };
      pending.set(workspaceKey(branch), { branch, workspace, source, old, cache: provisional });
      await git(["worktree", "add", "--detach", "--no-checkout", workspace, branch.headSha]);
      const gitDir = path.join(repository, "worktrees", gitDirectory);
      await options.fetch(() =>
        options.run(
          [
            "git",
            `--git-dir=${gitDir}`,
            `--work-tree=${workspace}`,
            "-c",
            "core.hooksPath=/dev/null",
            "checkout",
            "--quiet",
            "--detach",
            branch.headSha,
          ],
          { cwd: options.root, env, signal, timeoutMs: 10 * 60_000 },
        ),
      );
      let copied = true;
      if (source)
        copied = (
          await privateTreeOperation(
            "copy-caches",
            source,
            workspace,
            undefined,
            options.copyBudgetBytes,
          )
        ).complete;
      const cache: WorkspaceCache = {
        ...sourceCache,
        headSha: branch.headSha,
        gitDirectory,
        appliedPaths: [],
        installed: Boolean(sourceCache?.installed && copied),
        exposed: false,
        legacyWorkspace: source === legacy ? legacy : sourceCache?.legacyWorkspace,
        lastUsedAt: Date.now(),
      };
      pending.set(workspaceKey(branch), { branch, workspace, source, old, cache });
      return { workspace, cache };
    });
  }

  async function revokeWorkspaceAccess(workspace: string, uid?: number) {
    if (process.platform !== "linux" || process.getuid?.() !== 0) return;
    const directory = await open(
      workspace,
      constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
    );
    try {
      if (uid !== undefined && (await directory.stat()).uid !== uid) return;
      await directory.chown(0, 0);
      await directory.chmod(0o700);
    } finally {
      await directory.close();
    }
  }

  const retiredReceiptPath = (id: string) =>
    path.join(metadata, `${retiredReceiptPrefix}${id}.json`);
  const gitBacklinkPath = (gitDir: string) => path.join(gitDir, "gitdir");

  function writeRetirementReceipt(id: string, receipt: RetirementReceipt) {
    return atomicWrite(retiredReceiptPath(id), JSON.stringify(receipt), 0o600);
  }

  async function retireDirectory(
    source: string,
    { gitDir, exposed }: Omit<RetirementReceipt, "directory">,
  ) {
    await lockedRuntime(privateTreeCleanupIdentity.uid, async () => {
      const id = randomUUID();
      const directory = path.join(retired, id);
      await writeRetirementReceipt(id, { directory, gitDir, exposed });
      await rename(source, directory);
      if (gitDir && (await exists(gitDir)))
        await writeFile(gitBacklinkPath(gitDir), `${path.join(directory, ".git")}\n`);
    });
  }

  async function recoverRetiredReceipts(recorded: Set<string>) {
    const unrecorded = (await readdir(retired, { withFileTypes: true })).filter(
      (entry) =>
        entry.isDirectory() && opaqueWorkspaceName.test(entry.name) && !recorded.has(entry.name),
    );
    if (unrecorded.length === 0) return;

    // Read backlinks from controller-owned Git registrations, never from retired trees.
    const registrations = new Map<string, string>();
    for (const repository of await readdir(repositories, { withFileTypes: true })) {
      if (!repository.isDirectory() || !repositoryName.test(repository.name)) continue;
      const gitWorktrees = path.join(repositories, repository.name, "worktrees");
      const entries = await readdir(gitWorktrees, { withFileTypes: true }).catch((error) => {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
        throw error;
      });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const gitDir = path.join(gitWorktrees, entry.name);
        const backlink = await readFile(gitBacklinkPath(gitDir), "utf8").catch((error) => {
          if ((error as NodeJS.ErrnoException).code === "ENOENT") return "";
          throw error;
        });
        if (backlink) registrations.set(backlink.trimEnd(), gitDir);
      }
    }
    for (const { name } of unrecorded) {
      const directory = path.join(retired, name);
      await writeRetirementReceipt(name, {
        directory,
        gitDir: registrations.get(path.join(directory, ".git")),
        exposed: true,
      });
      recorded.add(name);
    }
  }

  async function cleanupRetired(recover = false) {
    await lockedRuntime(privateTreeCleanupIdentity.uid, async () => {
      const recorded = new Set(
        (await readdir(metadata)).flatMap((filename) => {
          const match = retiredReceiptName.exec(filename);
          return match?.[1] ? [match[1]] : [];
        }),
      );
      if (recover) await recoverRetiredReceipts(recorded);
      for (const id of recorded) {
        const receiptPath = retiredReceiptPath(id);
        const receipt = JSON.parse(await readFile(receiptPath, "utf8")) as RetirementReceipt;
        const directory = path.join(retired, id);
        if (receipt.directory !== directory)
          throw new Error("Неверная папка устаревшего предпросмотра");
        try {
          // When only the intent was written, the Git registration still belongs to the source.
          if (await exists(directory)) {
            if (receipt.gitDir) await rm(receipt.gitDir, { recursive: true, force: true });
            if (!receipt.exposed) await rm(directory, { recursive: true, force: true });
            else {
              await privateTreeOperation("prepare-cleanup", directory);
              await privateTreeOperation("clear", directory, undefined, privateTreeCleanupIdentity);
              await rmdir(directory);
            }
          }
          await rm(receiptPath, { force: true });
        } catch {
          // Retry incomplete cleanup on the next prune.
        }
      }
    });
  }

  async function discard(branch: Pick<WorkspaceBranch, "projectId" | "branch">) {
    await locked(branch.projectId, async () => {
      const stage = pending.get(workspaceKey(branch));
      if (!stage) return;
      // This ancestor never grants a runtime UID traversal rights.
      await rm(stage.workspace, { recursive: true, force: true });
      if (stage.cache.gitDirectory)
        await rm(
          path.join(repositoryPath(branch.projectId), "worktrees", stage.cache.gitDirectory),
          { recursive: true, force: true },
        );
      pending.delete(workspaceKey(branch));
    });
  }

  async function retireWorkspace(
    branch: Pick<WorkspaceBranch, "projectId" | "branch">,
    cache: WorkspaceCache | null,
  ) {
    const workspace = workspacePath(branch);
    if (!(await exists(workspace))) return;
    const gitDirectory = cache?.gitDirectory ?? workspaceKey(branch);
    const gitDir = path.join(repositoryPath(branch.projectId), "worktrees", gitDirectory);
    await retireDirectory(workspace, { gitDir, exposed: cache?.exposed !== false });
  }

  async function publish(branch: WorkspaceBranch, identity?: { uid: number; gid: number }) {
    if (identity?.uid === privateTreeCleanupIdentity.uid)
      throw new Error("UID очистки нельзя передавать процессу сайта");
    return locked(branch.projectId, async () => {
      const stage = pending.get(workspaceKey(branch));
      if (!stage) throw new Error("Приватная подготовка предпросмотра не найдена");
      // Reads of old runtime inodes are descriptor-relative and never follow links.
      if (stage.source) await privateTreeOperation("preserve-times", stage.source, stage.workspace);
      if (identity && process.platform === "linux" && process.getuid?.() === 0)
        // No site can reach this tree: its ancestor stays root-only until rename below.
        await options.run(
          ["chown", "-h", "-R", "-P", `${identity.uid}:${identity.gid}`, stage.workspace],
          { cwd: options.root, timeoutMs: 120_000 },
        );
      await retireWorkspace(branch, stage.old);
      const workspace = workspacePath(branch);
      const gitDir = path.join(
        repositoryPath(branch.projectId),
        "worktrees",
        stage.cache.gitDirectory ?? "",
      );
      await writeFile(gitBacklinkPath(gitDir), `${path.join(workspace, ".git")}\n`);
      await rename(stage.workspace, workspace);
      pending.delete(workspaceKey(branch));
      const cache = {
        ...stage.cache,
        uid: identity?.uid,
        gid: identity?.gid,
        exposed: Boolean(identity),
        lastUsedAt: Date.now(),
      };
      await saveCache(branch, cache);
      await cleanupRetired();
      return { workspace, cache };
    });
  }

  async function restore(workspace: string, filename: string, headSha?: string) {
    const { safePath } = await import("@pushdocs/content");
    const safe = safePath(filename);
    const stage = [...pending.values()].find((item) => item.workspace === workspace);
    let cache: WorkspaceCache & Partial<WorkspaceBranch>;
    let location: string[];
    if (stage) {
      cache = stage.cache;
      location = [
        `--git-dir=${path.join(repositoryPath(stage.branch.projectId), "worktrees", stage.cache.gitDirectory ?? "")}`,
        `--work-tree=${workspace}`,
      ];
    } else {
      if (path.dirname(workspace) !== worktrees || !/^[a-f0-9]{64}$/.test(path.basename(workspace)))
        throw new Error("Неизвестная рабочая папка предпросмотра");
      cache = JSON.parse(
        await readFile(path.join(metadata, `${path.basename(workspace)}.json`), "utf8"),
      );
      if (cache.exposed !== false)
        throw new Error("Root restore requires a private preparation tree");
      if (!cache.projectId || !cache.branch)
        throw new Error("Метаданные рабочей папки отсутствуют");
      location = [
        `--git-dir=${path.join(repositoryPath(cache.projectId), "worktrees", cache.gitDirectory ?? path.basename(workspace))}`,
        `--work-tree=${workspace}`,
      ];
    }
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
      await revokeWorkspaceAccess(previousWorkspace, uid);
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
    const cache = await readCache(branch);
    if (cache) await saveCache(branch, { ...cache, exposed: true });
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
      await retireWorkspace(branch, await readCache(branch));
      await rm(cachePath(branch), { force: true });
      await cleanupRetired();
    });
  }

  async function retireAbandonedPreparations() {
    // An ensure() between mkdir and pending registration still holds a project lock.
    if (locks.size > 0) return;
    for (const entry of await readdir(preparing, { withFileTypes: true })) {
      if (!entry.isDirectory() || !opaqueWorkspaceName.test(entry.name)) continue;
      const directory = path.join(preparing, entry.name);
      if ([...pending.values()].some((stage) => stage.workspace === directory)) continue;
      let gitDir: string | undefined;
      for (const repository of await readdir(repositories, { withFileTypes: true })) {
        if (!repository.isDirectory() || !repositoryName.test(repository.name)) continue;
        const candidate = path.join(repositories, repository.name, "worktrees", entry.name);
        if (await exists(candidate)) {
          if (gitDir) throw new Error("Неоднозначная регистрация приватной рабочей папки");
          gitDir = candidate;
        }
      }
      await retireDirectory(directory, { gitDir, exposed: true });
    }
  }

  async function prune(
    active: Set<string>,
    cutoff: number,
    protectedLegacyIds = new Set<string>(),
    maxBytes = privateTreeCopyBudget,
  ) {
    await initialize();
    await retireAbandonedPreparations();
    await cleanupRetired(true);
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
      if (!entry.isDirectory() || !repositoryName.test(entry.name)) continue;
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
      if (!entry.isDirectory() || !opaqueWorkspaceName.test(entry.name)) continue;
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
      if (!candidate.legacy && candidate.metadata && (await exists(candidate.metadata))) {
        const cache = JSON.parse(await readFile(candidate.metadata, "utf8")) as WorkspaceCache &
          WorkspaceBranch;
        await remove(cache);
      } else {
        await retireDirectory(candidate.directory, { exposed: true });
        if (candidate.metadata) await rm(candidate.metadata, { force: true });
        await cleanupRetired();
      }
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
      if (!entry.isDirectory() || !repositoryName.test(entry.name)) continue;
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
    publish,
    discard,
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
