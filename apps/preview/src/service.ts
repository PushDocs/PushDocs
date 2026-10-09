import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { stripVTControlCharacters } from "node:util";
import { parseProjectConfig, safePath } from "@pushdocs/content";
import { decryptSecret, type PushDocsRepository } from "@pushdocs/db";
import { prepareVpnAccess } from "@pushdocs/vpn";
import { prepareDocusaurusPreview } from "./docusaurus";
import {
  nodeHeapLimitMb,
  positiveInteger,
  stopRuntimeProcesses,
  watchRuntimeMemory,
} from "./resources";
import {
  atomicWrite,
  createWorkspaceManager,
  type WorkspaceBranch,
  workspaceKey,
} from "./workspaces";

type PreviewRepository = Pick<
  PushDocsRepository,
  | "getProjectSyncTarget"
  | "listChangedWorkingFiles"
  | "listPreviewAttachments"
  | "listPreviewSessions"
  | "listPreviewWorkspaces"
  | "reconcilePreviewLeases"
  | "updatePreviewSession"
> &
  Partial<
    Pick<
      PushDocsRepository,
      "listPreviewInventory" | "recordPreviewWorkspace" | "finishPreviewDeletion"
    >
  >;

type PreviewSession = Awaited<ReturnType<PreviewRepository["listPreviewSessions"]>>[number];

type RunningPreview = {
  appliedPaths: Set<string>;
  child: ChildProcess;
  headSha: string;
  revision: number;
  stopping: boolean;
  workspace: string;
  stopMemoryWatch: () => void;
  launchHash: string;
  uid: number;
  generatedConfig?: string;
  stoppingTask?: Promise<void>;
  failureTask?: Promise<void>;
};

export async function previewEndpointReady(port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/`, {
      signal: AbortSignal.timeout(1500),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export interface PreviewServiceOptions {
  attachmentsRoot?: string;
  decryptSecret?: (value: string) => string;
  logger?: Pick<Console, "error" | "log">;
  prepareVpnAccess?: typeof prepareVpnAccess;
  repository: PreviewRepository;
  workspaceRoot?: string;
  gitAccess?: (projectId: string) => Promise<{ remote: string; env: NodeJS.ProcessEnv }>;
  maxActive?: number;
  memoryLimitMb?: number;
  cacheMaxMb?: number;
}

const defaultPreview = {
  install: ["yarn", "install", "--frozen-lockfile"],
  start: ["yarn", "start", "--host", "0.0.0.0", "--port", "{port}", "--no-open"],
};

function commandArgs(command: string[], port?: number): [string, string[]] {
  if (command.length === 0 || command.length > 40 || command.some((part) => part.length > 1000))
    throw new Error("Команда предпросмотра настроена неверно");
  const expanded = command.map((part) =>
    part === "{port}" ? String(port) : part === "{host}" ? "0.0.0.0" : part,
  );
  if (expanded.some((part) => part.includes("{port}") || part.includes("{host}")))
    throw new Error("Подстановки preview разрешены только как отдельные аргументы");
  return [expanded[0] ?? "", expanded.slice(1)];
}

export function previewExitError(output: string, code: number | null, signal: string | null) {
  const lines = stripVTControlCharacters(output)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const errors = lines.filter((line) => /^\[(?:ERROR|FATAL)\]/i.test(line));
  if (errors.length) return `Не удалось запустить предпросмотр: ${errors.join("\n").slice(-1200)}`;
  return `Сайт предпросмотра неожиданно завершился (${signal ?? `код ${code ?? "unknown"}`}). ${lines.slice(-4).join("\n").slice(-1000)}`;
}

const transientFetchError =
  /early EOF|unexpected disconnect|invalid index-pack output|RPC failed|remote end hung up unexpectedly/i;

export async function retryGitFetch<T>(
  operation: () => Promise<T>,
  options: {
    attempts?: number;
    delay?: (attempt: number) => Promise<void>;
    onRetry?: (error: Error, attempt: number) => Promise<void> | void;
  } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await operation();
    } catch (cause) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (attempt === attempts || !transientFetchError.test(error.message)) throw error;
      await options.onRetry?.(error, attempt);
      await (options.delay?.(attempt) ??
        new Promise<void>((resolve) => setTimeout(resolve, attempt * 1000)));
    }
  }
  throw new Error("Git fetch не был выполнен");
}

function childEnvironment(): NodeJS.ProcessEnv {
  const allowed = ["PATH", "HOME", "LANG", "LC_ALL", "TZ", "COREPACK_HOME", "NODE_EXTRA_CA_CERTS"];
  return Object.fromEntries(
    allowed.flatMap((key) => (process.env[key] ? [[key, process.env[key]]] : [])),
  );
}

async function assertNoSymlink(root: string, relativePath: string): Promise<string> {
  const safe = safePath(relativePath);
  const destination = path.resolve(root, safe);
  if (!destination.startsWith(`${path.resolve(root)}${path.sep}`))
    throw new Error("Файл предпросмотра выходит за рабочий каталог");
  let current = root;
  const parts = safe.split("/");
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error(`Предпросмотр не записывает через symlink: ${relativePath}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  try {
    if ((await lstat(destination)).isSymbolicLink())
      throw new Error(`Предпросмотр не заменяет symlink: ${relativePath}`);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return destination;
}

export async function writePreviewFile(destination: string, content: string | Buffer) {
  try {
    if (
      (await readFile(destination)).equals(
        Buffer.isBuffer(content) ? content : Buffer.from(content),
      )
    )
      return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  await atomicWrite(destination, content);
  return true;
}

export async function run(
  command: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    gid?: number;
    maxOutput?: number;
    signal?: AbortSignal;
    timeoutMs: number;
    uid?: number;
    memoryLimitMb?: number;
  },
): Promise<string> {
  const [executable, args] = commandArgs(command);
  if (executable === "git") {
    const changeDirectory = args.indexOf("-C");
    const directory =
      changeDirectory >= 0
        ? path.resolve(options.cwd, args[changeDirectory + 1] ?? ".")
        : options.cwd;
    // Controller-owned Git state may refer to a workspace owned by its isolated runtime user.
    args.unshift("-c", `safe.directory=${directory}`);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      detached: true,
      env: options.env ?? childEnvironment(),
      gid: options.gid,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
      uid: options.uid,
    });
    let output = "";
    let settled = false;
    let timedOut = false;
    let resourceError: string | undefined;
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-(options.maxOutput ?? 32_000));
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timeout = setTimeout(() => {
      timedOut = true;
      terminate("SIGKILL");
    }, options.timeoutMs);
    const abort = () => terminate("SIGTERM");
    const stopMemoryWatch = watchRuntimeMemory(options.uid, options.memoryLimitMb, (message) => {
      resourceError = message;
      terminate("SIGKILL");
    });
    let abortTimeout: ReturnType<typeof setTimeout> | undefined;
    const cancel = () => {
      abort();
      abortTimeout = setTimeout(() => terminate("SIGKILL"), 5000);
    };
    options.signal?.addEventListener("abort", cancel, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      clearTimeout(abortTimeout);
      stopMemoryWatch();
      options.signal?.removeEventListener("abort", cancel);
      settled = true;
      reject(error);
    });
    child.on("close", async (code) => {
      terminate("SIGKILL");
      clearTimeout(timeout);
      clearTimeout(abortTimeout);
      stopMemoryWatch();
      options.signal?.removeEventListener("abort", cancel);
      if (settled) return;
      settled = true;
      try {
        await stopRuntimeProcesses(options.uid);
      } catch (error) {
        reject(error);
        return;
      }
      if (resourceError) reject(new Error(resourceError));
      else if (/heap out of memory|Allocation failed.*heap|Reached heap limit/i.test(output))
        reject(
          new Error(
            `Предпросмотру не хватило памяти JavaScript: ${options.memoryLimitMb ?? "неизвестно"} МБ выделено на запуск сайта.`,
          ),
        );
      else if (options.signal?.aborted) reject(new Error("Запуск предпросмотра отменён"));
      else if (timedOut)
        reject(
          new Error(
            `${executable} превысил время ожидания (${Math.ceil(options.timeoutMs / 60_000)} мин). ${output.slice(-4000)}`,
          ),
        );
      else if (code === 0) resolve(output);
      else reject(new Error(`${executable} завершился с кодом ${code}: ${output.slice(-4000)}`));
    });
    if (options.signal?.aborted) cancel();
  });
}

export function createPreviewService(options: PreviewServiceOptions) {
  const repository = options.repository;
  const decrypt = options.decryptSecret ?? decryptSecret;
  const vpnAccess = options.prepareVpnAccess ?? prepareVpnAccess;
  const logger = options.logger ?? console;
  const workspaceRoot = path.resolve(
    options.workspaceRoot ?? process.env.PUSHDOCS_PREVIEW_DIR ?? "./data/previews",
  );
  const attachmentsRoot = path.resolve(
    options.attachmentsRoot ?? process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "./data/attachments",
  );
  const runtimeUidFrom = Number(process.env.PUSHDOCS_PREVIEW_RUNTIME_UID_FROM ?? 11000);
  const runtimeGidFrom = Number(process.env.PUSHDOCS_PREVIEW_RUNTIME_GID_FROM ?? runtimeUidFrom);
  const maxActive = positiveInteger(
    options.maxActive ?? process.env.PUSHDOCS_PREVIEW_MAX_ACTIVE,
    1,
    "Лимит активных предпросмотров",
  );
  const memoryLimitMb = positiveInteger(
    options.memoryLimitMb ?? process.env.PUSHDOCS_PREVIEW_MEMORY_MB,
    4096,
    "Лимит памяти предпросмотра",
  );
  const cacheMaxBytes =
    positiveInteger(
      options.cacheMaxMb ?? process.env.PUSHDOCS_PREVIEW_CACHE_MAX_MB,
      8192,
      "Лимит дискового кеша предпросмотров",
    ) *
    1024 *
    1024;
  const portFrom = Number(process.env.PUSHDOCS_PREVIEW_PORT_FROM ?? 43000);
  const heapLimitMb = nodeHeapLimitMb(memoryLimitMb, process.env.PUSHDOCS_PREVIEW_NODE_HEAP_MB);
  if (
    !Number.isInteger(runtimeUidFrom) ||
    runtimeUidFrom <= 0 ||
    !Number.isInteger(runtimeGidFrom) ||
    runtimeGidFrom <= 0 ||
    !Number.isInteger(portFrom)
  )
    throw new Error("UID процесса предпросмотра настроен неверно");
  const runtimeIdentity = (session: PreviewSession, workspace: string) => {
    const uid = runtimeUidFrom + session.port - portFrom;
    if (uid < runtimeUidFrom || uid >= runtimeUidFrom + 100)
      throw new Error("Для порта предпросмотра не выделен Unix пользователь");
    return {
      env: {
        ...childEnvironment(),
        COREPACK_HOME: path.join(workspace, ".corepack"),
        HOME: path.join(workspace, ".home"),
        NODE_OPTIONS: `--max-old-space-size=${heapLimitMb}`,
        npm_config_cache: path.join(workspace, ".package-cache", "npm"),
        YARN_CACHE_FOLDER: path.join(workspace, ".package-cache", "yarn"),
        GIT_CONFIG_COUNT: "1",
        GIT_CONFIG_KEY_0: "safe.directory",
        GIT_CONFIG_VALUE_0: workspace,
      },
      gid: runtimeGidFrom + session.port - portFrom,
      uid,
    };
  };
  const running = new Map<string, RunningPreview>();
  const starting = new Map<string, AbortController>();
  const startTasks = new Map<string, Promise<void>>();
  const preparations = new Map<string, Promise<void>>();
  const preparationControllers = new Map<string, AbortController>();
  const retryAfter = new Map<string, number>();
  let shuttingDown = false;
  let lastPruneAt = 0;
  let lastInventoryAt = 0;
  const evictedWorkspaces = new Set<string>();
  const branchRef = (
    session: Pick<PreviewSession, "project_id" | "branch">,
    headSha: string,
  ): WorkspaceBranch => ({ projectId: session.project_id, branch: session.branch, headSha });
  const workspaces = createWorkspaceManager({
    root: workspaceRoot,
    isActive: (key) =>
      preparations.has(key) ||
      [...running.values()].some((preview) => path.basename(preview.workspace) === key),
    run,
    access:
      options.gitAccess ??
      (async (projectId) => {
        const target = await repository.getProjectSyncTarget(projectId);
        if (!target) throw new Error("Подключение проекта недоступно");
        return gitEnvironment(target);
      }),
    fetch: (operation) => retryGitFetch(operation),
  });

  async function installFingerprint(
    workspace: string,
    cwd: string,
    install: string[],
    legacyWorkspace?: string,
  ) {
    const hash = createHash("sha256").update(JSON.stringify(install));
    if (!legacyWorkspace) hash.update(process.version);
    for (const filename of [
      "package.json",
      "yarn.lock",
      "package-lock.json",
      "pnpm-lock.yaml",
      ".yarnrc.yml",
      ...(legacyWorkspace ? [] : [".yarnrc", ".npmrc"]),
    ]) {
      for (const directory of new Set([workspace, cwd])) {
        try {
          hash.update(
            legacyWorkspace
              ? path.join(legacyWorkspace, path.relative(workspace, directory), filename)
              : path.join(path.relative(workspace, directory), filename),
          );
          hash.update(await readFile(path.join(directory, filename)));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    if (!legacyWorkspace) {
      // Include workspace manifests and package-manager plugins, patches and configuration.
      const { readdir } = await import("node:fs/promises");
      const visit = async (directory: string) => {
        for (const entry of (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
          a.name.localeCompare(b.name),
        )) {
          if (
            [
              "node_modules",
              ".git",
              ".home",
              ".corepack",
              ".package-cache",
              ".next",
              ".docusaurus",
              "build",
              "dist",
              "cache",
              "unplugged",
            ].includes(entry.name)
          )
            continue;
          const fullPath = path.join(directory, entry.name);
          if (entry.isDirectory()) await visit(fullPath);
          else if (
            entry.isFile() &&
            (entry.name === "package.json" ||
              /^\.yarn\/(plugins|patches|releases)\//.test(path.relative(workspace, fullPath)))
          ) {
            hash.update(path.relative(workspace, fullPath));
            hash.update(await readFile(fullPath));
          }
        }
      };
      await visit(workspace);
    }
    return hash.digest("hex");
  }

  const appendLog = async (sessionId: string, value: string) => {
    const session = (await repository.listPreviewSessions()).find((item) => item.id === sessionId);
    await repository.updatePreviewSession(sessionId, {
      log: `${session?.log ?? ""}${value}`.slice(-32_000),
    });
  };

  async function gitEnvironment(target: {
    base_url: string;
    clone_url: string;
    kind: "github" | "gitlab";
    secret_encrypted: string;
    vpn_profile_encrypted: string | null;
    vpn_slot: number | null;
    connection_id: string;
  }) {
    const remote = new URL(target.clone_url);
    const connection = new URL(target.base_url);
    if (
      remote.protocol === "http:" &&
      connection.protocol === "https:" &&
      remote.hostname === connection.hostname &&
      !remote.port &&
      !connection.port
    )
      remote.protocol = "https:";
    if (remote.origin !== connection.origin)
      throw new Error("Адрес Git не совпадает с подключением");
    const token = decrypt(target.secret_encrypted);
    const header = `Authorization: Basic ${Buffer.from(`${target.kind === "gitlab" ? "oauth2" : "x-access-token"}:${token}`).toString("base64")}`;
    const profile = target.vpn_profile_encrypted
      ? decrypt(target.vpn_profile_encrypted)
      : undefined;
    const access = profile
      ? await vpnAccess({
          allowedOrigin: target.base_url,
          connectionId: target.connection_id,
          profile,
          slot: target.vpn_slot,
        })
      : undefined;
    const configuration = [
      ["http.extraHeader", header],
      ...(access?.gitProxyUrl ? [["http.proxy", access.gitProxyUrl]] : []),
    ];
    return {
      remote: remote.href,
      env: {
        ...childEnvironment(),
        GIT_TERMINAL_PROMPT: "0",
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_CONFIG_COUNT: String(configuration.length),
        ...Object.fromEntries(
          configuration.flatMap(([key, value], index) => [
            [`GIT_CONFIG_KEY_${index}`, key],
            [`GIT_CONFIG_VALUE_${index}`, value],
          ]),
        ),
      },
    };
  }

  async function previewState(session: PreviewSession) {
    const [working, attachments] = await Promise.all([
      repository.listChangedWorkingFiles(session.project_id, session.branch),
      repository.listPreviewAttachments(session.project_id, session.branch),
    ]);
    return { attachments, working };
  }

  async function restorePath(workspace: string, relativePath: string): Promise<void> {
    await assertNoSymlink(workspace, relativePath);
    await workspaces.restore(workspace, relativePath);
  }

  async function applyOverlay(
    session: PreviewSession,
    active: Pick<RunningPreview, "appliedPaths" | "workspace">,
  ) {
    const target = await repository.getProjectSyncTarget(session.project_id);
    if (!target) throw new Error("Подключение проекта недоступно");
    const { attachments, working } = await previewState(session);
    const rootPath = target.root_path === "." ? "." : safePath(target.root_path);
    const prefix = rootPath === "." ? "" : `${rootPath}/`;
    const ref = branchRef(session, working.branch.head_commit_sha);
    const cache = await workspaces.readCache(ref);
    if (cache?.headSha !== working.branch.head_commit_sha)
      throw new Error("Ветка обновилась во время подготовки предпросмотра. Повторите запуск.");
    const changedPaths: string[] = [];
    const writtenPaths: string[] = [];
    const nextPaths = new Set([
      ...working.files.map((file) => `${prefix}${safePath(file.path)}`),
      ...attachments.map((file) => `${prefix}${safePath(file.repository_path)}`),
    ]);
    // Persist the touched paths before writing so interrupted overlays can be restored safely.
    await workspaces.saveCache(ref, {
      ...cache,
      appliedPaths: [...new Set([...active.appliedPaths, ...nextPaths])],
    });
    for (const file of working.files) {
      const relativePath = `${prefix}${safePath(file.path)}`;
      nextPaths.add(relativePath);
      const destination = await assertNoSymlink(active.workspace, relativePath);
      if (file.status === "delete") {
        await rm(destination, { force: true, recursive: true });
        changedPaths.push(relativePath);
      } else {
        if (await writePreviewFile(destination, file.content)) {
          changedPaths.push(relativePath);
          writtenPaths.push(destination);
        }
      }
    }
    for (const attachment of attachments) {
      const relativePath = `${prefix}${safePath(attachment.repository_path)}`;
      nextPaths.add(relativePath);
      const destination = await assertNoSymlink(active.workspace, relativePath);
      const source = path.resolve(attachmentsRoot, attachment.storage_key);
      if (!source.startsWith(`${attachmentsRoot}${path.sep}`))
        throw new Error("Путь вложения выходит за хранилище");
      if (await writePreviewFile(destination, await readFile(source))) {
        changedPaths.push(relativePath);
        writtenPaths.push(destination);
      }
    }
    for (const previous of active.appliedPaths)
      if (!nextPaths.has(previous)) {
        await restorePath(active.workspace, previous);
        changedPaths.push(previous);
      }
    if (cache.uid !== undefined && writtenPaths.length > 0) {
      const owned = new Set(writtenPaths);
      for (const filename of writtenPaths) {
        let parent = path.dirname(filename);
        while (parent !== active.workspace) {
          owned.add(parent);
          parent = path.dirname(parent);
        }
      }
      const paths = [...owned];
      for (let offset = 0; offset < paths.length; offset += 30)
        await run(
          ["chown", `${cache.uid}:${cache.gid ?? cache.uid}`, ...paths.slice(offset, offset + 30)],
          { cwd: active.workspace, timeoutMs: 30_000 },
        );
    }
    active.appliedPaths = nextPaths;
    await workspaces.saveCache(ref, {
      ...cache,
      appliedPaths: [...nextPaths],
      revision: working.changeSet?.revision ?? 0,
    });
    return {
      headSha: working.branch.head_commit_sha,
      revision: working.changeSet?.revision ?? 0,
      rootPath: target.root_path,
      changedPaths,
    };
  }

  async function waitUntilReady(
    child: ChildProcess,
    port: number,
    signal: AbortSignal,
    failure: () => string | undefined,
  ): Promise<void> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      signal.throwIfAborted();
      const message = failure();
      if (message) throw new Error(message);
      if (child.exitCode !== null || child.signalCode !== null)
        throw new Error("Процесс предпросмотра завершился при запуске");
      if (await previewEndpointReady(port)) return;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    throw new Error("Предпросмотр не открыл порт за 180 секунд");
  }

  async function launchSettings(workspace: string, rootPath: string) {
    const root = rootPath === "." ? "." : safePath(rootPath);
    let config = parseProjectConfig();
    try {
      config = parseProjectConfig(
        await readFile(
          await assertNoSymlink(
            workspace,
            root === "." ? ".pushdocs/config.json" : `${root}/.pushdocs/config.json`,
          ),
          "utf8",
        ),
      );
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const preview = config.preview ?? defaultPreview;
    const cwd = path.resolve(workspace, root);
    const installHash = await installFingerprint(workspace, cwd, preview.install);
    return {
      cwd,
      preview,
      installHash,
      launchHash: `${installHash}:${JSON.stringify(preview.start)}`,
    };
  }

  async function start(session: PreviewSession): Promise<void> {
    const startedAt = Date.now();
    const controller = new AbortController();
    let launched: RunningPreview | undefined;
    let generatedConfig: string | undefined;
    starting.set(session.id, controller);
    let startupOutput = "";
    let startupFailure: string | undefined;
    try {
      const current = await repository.listChangedWorkingFiles(session.project_id, session.branch);
      const ref = branchRef(session, current.branch.head_commit_sha);
      await repository.updatePreviewSession(session.id, {
        last_error: null,
        log: `Подготавливаем рабочую папку ветки ${session.branch} (${ref.headSha.slice(0, 8)})…`,
        status: "starting",
      });
      await preparations.get(workspaceKey(ref));
      controller.signal.throwIfAborted();
      const { workspace, cache: cached } = await workspaces.ensure(
        ref,
        controller.signal,
        session.id,
      );
      const target = await repository.getProjectSyncTarget(session.project_id);
      if (!target) throw new Error("Подключение проекта недоступно");
      await repository.updatePreviewSession(session.id, {
        log: "Подготавливаем черновики и вложения…",
      });
      const draft = { appliedPaths: new Set(cached.appliedPaths), workspace };
      const state = await applyOverlay(session, draft);
      const { cwd, preview, installHash, launchHash } = await launchSettings(
        workspace,
        target.root_path,
      );
      const runtime = runtimeIdentity(session, workspace);
      await stopRuntimeProcesses(runtime.uid);
      await mkdir(runtime.env.HOME, { recursive: true, mode: 0o700 });
      await mkdir(runtime.env.COREPACK_HOME, { recursive: true, mode: 0o700 });
      await mkdir(runtime.env.npm_config_cache, { recursive: true, mode: 0o700 });
      const packageCache = path.join(workspace, ".package-cache");
      if ((await lstat(packageCache)).uid !== runtime.uid)
        await run(["chown", "-R", `${runtime.uid}:${runtime.gid}`, packageCache], {
          cwd: workspace,
          timeoutMs: 120_000,
        });
      if (cached.uid !== runtime.uid) {
        await run(["chown", "-R", `${runtime.uid}:${runtime.gid}`, workspace], {
          cwd: workspace,
          timeoutMs: 120_000,
        });
      } else if ((await lstat(workspace)).uid !== runtime.uid) {
        await run(["chown", `${runtime.uid}:${runtime.gid}`, workspace], {
          cwd: workspace,
          timeoutMs: 30_000,
        });
      }
      await workspaces.grantReadAccess(ref, runtime.uid);
      const legacyHash =
        cached.legacyWorkspace &&
        (await installFingerprint(workspace, cwd, preview.install, cached.legacyWorkspace));
      if (
        !cached.installed ||
        (cached.installHash !== installHash && cached.installHash !== legacyHash)
      ) {
        await workspaces.saveCache(ref, {
          ...cached,
          appliedPaths: [...draft.appliedPaths],
          installed: false,
          revision: state.revision,
        });
        await repository.updatePreviewSession(session.id, {
          log: "Устанавливаем зависимости. Это может занять несколько минут.",
        });
        const installLog = await run(preview.install, {
          cwd,
          env: runtime.env,
          gid: runtime.gid,
          signal: controller.signal,
          timeoutMs: 10 * 60_000,
          uid: runtime.uid,
          memoryLimitMb,
        });
        await appendLog(session.id, installLog);
      }
      await workspaces.saveCache(ref, {
        ...cached,
        appliedPaths: [...draft.appliedPaths],
        headSha: state.headSha,
        revision: state.revision,
        installHash,
        installed: true,
        uid: runtime.uid,
        gid: runtime.gid,
        legacyWorkspace: undefined,
        lastUsedAt: Date.now(),
      });
      if (controller.signal.aborted) throw new Error("Запуск предпросмотра отменён");
      await appendLog(session.id, "\nЗапускаем сайт и ждём ответа…");
      const startCommand = await prepareDocusaurusPreview({
        cwd,
        command: preview.start,
      });
      generatedConfig = startCommand !== preview.start ? startCommand.at(-1) : undefined;
      if (generatedConfig)
        await run(["chown", `${runtime.uid}:${runtime.gid}`, generatedConfig], {
          cwd: workspace,
          timeoutMs: 30_000,
        });
      const [executable, args] = commandArgs(startCommand, session.port);
      const child = spawn(executable, args, {
        cwd,
        detached: true,
        env: { ...runtime.env, PORT: String(session.port) },
        gid: runtime.gid,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        uid: runtime.uid,
      });
      const active: RunningPreview = {
        ...draft,
        child,
        headSha: state.headSha,
        revision: state.revision,
        stopping: false,
        stopMemoryWatch: () => {},
        launchHash,
        uid: runtime.uid,
        generatedConfig,
      };
      launched = active;
      running.set(session.id, active);
      const onOutput = (chunk: Buffer) => {
        startupOutput = `${startupOutput}${chunk.toString()}`.slice(-12000);
        if (/heap out of memory|Reached heap limit|Allocation failed.*heap/i.test(startupOutput))
          startupFailure = `Предпросмотр остановлен: сайту не хватило памяти JavaScript (лимит ${heapLimitMb} МБ).`;
        void appendLog(session.id, chunk.toString()).catch(() => undefined);
      };
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.on("exit", (code, signal) => {
        if (!active.stopping) {
          startupFailure ??= /heap out of memory|Reached heap limit|Allocation failed.*heap/i.test(
            startupOutput,
          )
            ? `Предпросмотр остановлен: сайту не хватило памяти JavaScript (лимит ${heapLimitMb} МБ).`
            : previewExitError(startupOutput, code, signal);
          void failActive(session.id, active, startupFailure).catch((error) =>
            logger.error(String(error)),
          );
        }
      });
      child.on("error", (error) => {
        startupFailure = `Не удалось запустить сайт: ${error.message}`;
      });
      let peakMemoryMb = 0;
      let lastResourceLog = 0;
      active.stopMemoryWatch = watchRuntimeMemory(
        runtime.uid,
        memoryLimitMb,
        (message) => {
          startupFailure = message;
          void failActive(session.id, active, message).catch((error) =>
            logger.error(String(error)),
          );
        },
        (memoryMb) => {
          peakMemoryMb = Math.max(peakMemoryMb, memoryMb);
          if (Date.now() - lastResourceLog >= 30_000) {
            lastResourceLog = Date.now();
            logger.log(
              JSON.stringify({
                previewSessionId: session.id,
                memoryMb: Math.round(memoryMb),
                peakMemoryMb: Math.round(peakMemoryMb),
                memoryLimitMb,
              }),
            );
          }
        },
      );
      await waitUntilReady(child, session.port, controller.signal, () => startupFailure);
      controller.signal.throwIfAborted();
      if (active.stopping) throw new Error(startupFailure ?? "Запуск предпросмотра отменён");
      await repository.recordPreviewWorkspace?.(session.project_id, session.branch, {
        ready_at: new Date(),
        startup_ms: Date.now() - startedAt,
        deleted: false,
      });
      lastInventoryAt = 0;
      await repository.updatePreviewSession(session.id, {
        head_sha: state.headSha,
        revision: state.revision,
        status: "ready",
      });
      logger.log(
        JSON.stringify({
          previewSessionId: session.id,
          branch: session.branch,
          headSha: state.headSha,
          startupMs: Date.now() - startedAt,
        }),
      );
    } catch (error) {
      if (launched?.failureTask) {
        await launched.failureTask;
        return;
      }
      const active = running.get(session.id);
      if (active)
        await stopProcess(session.id, active).catch((cause) => logger.error(String(cause)));
      const reason = error instanceof Error ? error.message : String(error);
      const message =
        (reason === "Процесс предпросмотра завершился при запуске" ||
          reason.startsWith("Предпросмотр не открыл порт")) &&
        startupOutput
          ? `${reason}: ${startupOutput}`
          : reason;
      await repository.updatePreviewSession(session.id, {
        last_error: controller.signal.aborted ? null : message,
        status: controller.signal.aborted ? "stopped" : "failed",
      });
      if (!controller.signal.aborted)
        logger.error(JSON.stringify({ error: message, previewSessionId: session.id }));
    } finally {
      if (generatedConfig && !running.has(session.id))
        await rm(generatedConfig, { force: true }).catch((error) => logger.error(String(error)));
      starting.delete(session.id);
    }
  }

  async function stopProcess(sessionId: string, active: RunningPreview): Promise<void> {
    if (active.stoppingTask) return active.stoppingTask;
    active.stoppingTask = stopProcessOnce(sessionId, active);
    return active.stoppingTask;
  }

  async function stopProcessOnce(sessionId: string, active: RunningPreview): Promise<void> {
    active.stopping = true;
    active.stopMemoryWatch();
    const pid = active.child.pid;
    if (pid) {
      const signalGroup = (signal: NodeJS.Signals) => {
        try {
          process.kill(-pid, signal);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      };
      signalGroup("SIGTERM");
      if (active.child.exitCode === null && active.child.signalCode === null)
        await new Promise<void>((resolve) => {
          const finish = () => {
            clearTimeout(timeout);
            active.child.removeListener("exit", finish);
            resolve();
          };
          const timeout = setTimeout(finish, 5000);
          active.child.once("exit", finish);
        });
      // Kill remaining descendants even if the package-manager parent has already exited.
      signalGroup("SIGKILL");
      if (active.child.exitCode === null && active.child.signalCode === null)
        await new Promise<void>((resolve, reject) => {
          const finish = () => {
            clearTimeout(timeout);
            resolve();
          };
          const timeout = setTimeout(() => {
            active.child.removeListener("exit", finish);
            reject(new Error("Не удалось остановить процесс предпросмотра"));
          }, 2000);
          active.child.once("exit", finish);
        });
    }
    await stopRuntimeProcesses(active.uid);
    if (active.generatedConfig) await rm(active.generatedConfig, { force: true });
    if (process.platform === "linux" && process.getuid?.() === 0)
      await run(["chown", "0:0", active.workspace], { cwd: active.workspace, timeoutMs: 30_000 });
    if (running.get(sessionId) === active) running.delete(sessionId);
  }

  function failActive(sessionId: string, active: RunningPreview, message: string) {
    active.failureTask ??= (async () => {
      await stopProcess(sessionId, active);
      await repository.updatePreviewSession(sessionId, { last_error: message, status: "failed" });
      logger.error(JSON.stringify({ error: message, previewSessionId: sessionId }));
    })();
    return active.failureTask;
  }

  async function tick(): Promise<void> {
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    if (shuttingDown) return;
    const inventory = (await repository.listPreviewInventory?.()) ?? [];
    for (const item of inventory) {
      if (item.deleted || item.delete_requested)
        evictedWorkspaces.add(workspaceKey({ projectId: item.project_id, branch: item.branch }));
      if (!item.delete_requested) continue;
      const ref = { projectId: item.project_id, branch: item.branch, headSha: "" };
      const key = workspaceKey(ref);
      preparationControllers.get(key)?.abort();
      await preparations.get(key);
      const oldSessions = await repository.listPreviewSessions();
      // Deleted database sessions are stopped by the orphan sweep below. Also wait for their
      // startup tasks before removing the worktree, so no process can recreate it mid-delete.
      const liveIds = new Set(oldSessions.map((session) => session.id));
      for (const [id, controller] of starting) if (!liveIds.has(id)) controller.abort();
      await Promise.all([...startTasks].filter(([id]) => !liveIds.has(id)).map(([, task]) => task));
      for (const [id, active] of running) if (!liveIds.has(id)) await stopProcess(id, active);
      await workspaces.remove(ref);
      await repository.finishPreviewDeletion?.(item.project_id, item.branch);
      lastInventoryAt = 0;
    }
    await repository.reconcilePreviewLeases();
    const sessions = await repository.listPreviewSessions();
    const sessionIds = new Set(sessions.map((session) => session.id));
    for (const [id, controller] of starting) if (!sessionIds.has(id)) controller.abort();
    for (const [id, active] of running) if (!sessionIds.has(id)) await stopProcess(id, active);
    if (Date.now() - lastPruneAt > 5 * 60_000) {
      const cutoff = Date.now() - 24 * 60 * 60_000;
      const pruned = await workspaces.prune(
        new Set([
          ...sessions
            .filter((session) => session.desired_state === "running")
            .map((session) => workspaceKey(branchRef(session, ""))),
          ...preparations.keys(),
        ]),
        cutoff,
        new Set(
          sessions
            .filter(
              (session) =>
                session.desired_state === "running" ||
                running.has(session.id) ||
                starting.has(session.id),
            )
            .map((session) => session.id),
        ),
        cacheMaxBytes,
      );
      lastPruneAt = Date.now();
      for (const key of pruned.removed) evictedWorkspaces.add(key);
      if (pruned.bytes > cacheMaxBytes)
        logger.error(
          "Кеш предпросмотров превышает лимит: активные рабочие каталоги защищены от очистки.",
        );
    }
    if (repository.recordPreviewWorkspace && Date.now() - lastInventoryAt > 60_000) {
      const cached = await workspaces.inventory();
      for (const item of cached) {
        const old = inventory.find(
          (row) => row.project_id === item.projectId && row.branch === item.branch,
        );
        if (old?.delete_requested || old?.deleted) continue;
        await repository.recordPreviewWorkspace(item.projectId, item.branch, {
          created_at: item.createdAt,
          disk_bytes: item.diskBytes,
          expires_at: item.expiresAt,
        });
      }
      for (const item of inventory) {
        if (
          item.deleted ||
          item.delete_requested ||
          item.disk_bytes === null ||
          item.preparation_status === "queued" ||
          item.preparation_status === "starting"
        )
          continue;
        if (!cached.some((row) => row.projectId === item.project_id && row.branch === item.branch))
          await repository.finishPreviewDeletion?.(item.project_id, item.branch);
      }
      lastInventoryAt = Date.now();
    }
    for (const session of sessions) {
      try {
        const active = running.get(session.id);
        if (session.desired_state === "stopped") {
          starting.get(session.id)?.abort();
          if (active) await stopProcess(session.id, active);
          if (session.status !== "stopped")
            await repository.updatePreviewSession(session.id, { status: "stopped" });
          continue;
        }
        if (!active) {
          if (!starting.has(session.id)) {
            if (session.status === "queued") {
              if (running.size + starting.size < maxActive) {
                const key = workspaceKey(branchRef(session, ""));
                evictedWorkspaces.delete(key);
                for (const [other, controller] of preparationControllers)
                  if (other !== key) controller.abort();
                const task = start(session)
                  .catch((error) => logger.error(String(error)))
                  .finally(() => startTasks.delete(session.id));
                startTasks.set(session.id, task);
              } else if (!session.log?.startsWith("Ожидаем свободное место"))
                await repository.updatePreviewSession(session.id, {
                  log: "Ожидаем свободное место для предпросмотра. Другой сайт уже использует выделенные ресурсы.",
                });
            } else if (
              session.status === "ready" ||
              session.status === "starting" ||
              session.status === "stopped"
            )
              await repository.updatePreviewSession(session.id, { status: "queued" });
          }
          continue;
        }
        const state = await previewState(session);
        const revision = state.working.changeSet?.revision ?? 0;
        if (state.working.branch.head_commit_sha !== active.headSha) {
          await stopProcess(session.id, active);
          await repository.updatePreviewSession(session.id, { status: "queued" });
          continue;
        }
        if (revision !== active.revision) {
          const updated = await applyOverlay(session, active);
          active.revision = updated.revision;
          if (
            updated.changedPaths.some((filename) =>
              /(^|\/)(package\.json|yarn\.lock|package-lock\.json|pnpm-lock\.yaml|\.yarnrc(?:\.yml)?|\.npmrc)$|(^|\/)\.yarn\/|(^|\/)\.pushdocs\/config\.json$/.test(
                filename,
              ),
            )
          ) {
            const settings = await launchSettings(active.workspace, updated.rootPath);
            if (settings.launchHash !== active.launchHash) {
              await stopProcess(session.id, active);
              await repository.updatePreviewSession(session.id, { status: "queued" });
              continue;
            }
          }
          await repository.updatePreviewSession(session.id, { revision: updated.revision });
        }
      } catch (error) {
        const active = running.get(session.id);
        if (active)
          await stopProcess(session.id, active).catch((cause) => logger.error(String(cause)));
        const message = error instanceof Error ? error.message : String(error);
        await repository.updatePreviewSession(session.id, {
          last_error: message,
          status: "failed",
        });
        logger.error(JSON.stringify({ error: message, previewSessionId: session.id }));
      }
    }
    // Prepare imported branches independently of browser leases, one at a time.
    if (
      running.size === 0 &&
      starting.size === 0 &&
      preparations.size === 0 &&
      repository.listPreviewWorkspaces
    ) {
      const branches = await repository.listPreviewWorkspaces();
      for (const branch of branches) {
        const ref = {
          projectId: branch.project_id,
          branch: branch.full_ref.replace(/^refs\/heads\//, ""),
        };
        if (evictedWorkspaces.has(workspaceKey(ref))) continue;
        const known = inventory.find(
          (row) => row.project_id === ref.projectId && row.branch === ref.branch,
        );
        if (!known)
          await repository.recordPreviewWorkspace?.(ref.projectId, ref.branch, {
            preparation_status: "queued",
          });
      }
      for (const branch of branches) {
        const ref = {
          projectId: branch.project_id,
          branch: branch.full_ref.replace(/^refs\/heads\//, ""),
          headSha: branch.head_commit_sha,
        };
        const key = workspaceKey(ref);
        if (evictedWorkspaces.has(key) || (retryAfter.get(key) ?? 0) > Date.now()) continue;
        const cache = await workspaces.readCache(ref);
        const working = await repository.listChangedWorkingFiles(ref.projectId, ref.branch);
        if (
          cache?.headSha === ref.headSha &&
          cache.revision === (working.changeSet?.revision ?? 0)
        ) {
          await repository.recordPreviewWorkspace?.(ref.projectId, ref.branch, {
            preparation_status: "stopped",
          });
          continue;
        }
        const controller = new AbortController();
        const preparationStartedAt = Date.now();
        await repository.recordPreviewWorkspace?.(ref.projectId, ref.branch, {
          preparation_status: "starting",
        });
        preparationControllers.set(key, controller);
        const session = sessions.find(
          (item) => item.project_id === ref.projectId && item.branch === ref.branch,
        );
        const task = (async () => {
          try {
            const prepared = await workspaces.ensure(ref, controller.signal, session?.id);
            controller.signal.throwIfAborted();
            await applyOverlay(
              { project_id: ref.projectId, branch: ref.branch } as PreviewSession,
              { workspace: prepared.workspace, appliedPaths: new Set(prepared.cache.appliedPaths) },
            );
            await repository.recordPreviewWorkspace?.(ref.projectId, ref.branch, {
              preparation_status: "stopped",
              ready_at: new Date(),
              startup_ms: Date.now() - preparationStartedAt,
            });
            lastInventoryAt = 0;
          } catch (error) {
            if (!controller.signal.aborted) {
              await repository.recordPreviewWorkspace?.(ref.projectId, ref.branch, {
                preparation_status: "failed",
              });
              retryAfter.set(key, Date.now() + 60_000);
              logger.error(JSON.stringify({ error: String(error), previewWorkspace: key }));
            }
          } finally {
            preparations.delete(key);
            preparationControllers.delete(key);
          }
        })();
        preparations.set(key, task);
        break;
      }
    }
  }

  async function stopAll(): Promise<void> {
    shuttingDown = true;
    for (const controller of starting.values()) controller.abort();
    for (const controller of preparationControllers.values()) controller.abort();
    await Promise.allSettled([...preparations.values(), ...startTasks.values()]);
    await Promise.all([...running].map(([id, active]) => stopProcess(id, active)));
  }

  return { commandArgs, stopAll, tick };
}
