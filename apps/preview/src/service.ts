import { type ChildProcess, spawn } from "node:child_process";
import { chmod, cp, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseProjectConfig, safePath } from "@pushdocs/content";
import { decryptSecret, type PushDocsRepository } from "@pushdocs/db";
import { prepareVpnAccess } from "@pushdocs/vpn";

type PreviewRepository = Pick<
  PushDocsRepository,
  | "getProjectSyncTarget"
  | "listChangedWorkingFiles"
  | "listPreviewAttachments"
  | "listPreviewSessions"
  | "reconcilePreviewLeases"
  | "updatePreviewSession"
>;

type PreviewSession = Awaited<ReturnType<PreviewRepository["listPreviewSessions"]>>[number];

type RunningPreview = {
  appliedPaths: Set<string>;
  child: ChildProcess;
  headSha: string;
  revision: number;
  stopping: boolean;
  workspace: string;
};

export interface PreviewServiceOptions {
  attachmentsRoot?: string;
  decryptSecret?: (value: string) => string;
  logger?: Pick<Console, "error" | "log">;
  prepareVpnAccess?: typeof prepareVpnAccess;
  repository: PreviewRepository;
  workspaceRoot?: string;
}

const defaultPreview = {
  install: ["yarn", "install", "--frozen-lockfile"],
  start: ["yarn", "start", "--host", "0.0.0.0", "--port", "{port}", "--no-open", "--poll", "1000"],
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

async function run(
  command: string[],
  options: {
    cwd: string;
    env?: NodeJS.ProcessEnv;
    gid?: number;
    signal?: AbortSignal;
    timeoutMs: number;
    uid?: number;
  },
): Promise<string> {
  const [executable, args] = commandArgs(command);
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
    const terminate = (signal: NodeJS.Signals) => {
      if (!child.pid) return;
      try {
        process.kill(-child.pid, signal);
      } catch {
        child.kill(signal);
      }
    };
    const append = (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-32_000);
    };
    child.stdout?.on("data", append);
    child.stderr?.on("data", append);
    const timeout = setTimeout(() => terminate("SIGKILL"), options.timeoutMs);
    const abort = () => terminate("SIGTERM");
    options.signal?.addEventListener("abort", abort, { once: true });
    child.on("error", (error) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      settled = true;
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      if (options.signal?.aborted) reject(new Error("Запуск предпросмотра отменён"));
      else if (code === 0) resolve(output);
      else reject(new Error(`${executable} завершился с кодом ${code}: ${output.slice(-4000)}`));
    });
    if (options.signal?.aborted) abort();
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
  const portFrom = Number(process.env.PUSHDOCS_PREVIEW_PORT_FROM ?? 43000);
  if (!Number.isInteger(runtimeUidFrom) || !Number.isInteger(portFrom))
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
      },
      gid: uid,
      uid,
    };
  };
  const running = new Map<string, RunningPreview>();
  const starting = new Map<string, AbortController>();

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

  async function checkout(session: PreviewSession, workspace: string, signal: AbortSignal) {
    const target = await repository.getProjectSyncTarget(session.project_id);
    if (!target) throw new Error("Подключение проекта недоступно");
    const { remote, env } = await gitEnvironment(target);
    await rm(workspace, { recursive: true, force: true });
    await mkdir(workspace, { recursive: true, mode: 0o700 });
    await run(["git", "init", "--quiet"], { cwd: workspace, env, signal, timeoutMs: 30_000 });
    await run(["git", "config", "core.hooksPath", "/dev/null"], {
      cwd: workspace,
      env,
      signal,
      timeoutMs: 30_000,
    });
    await run(["git", "remote", "add", "origin", remote], {
      cwd: workspace,
      env,
      signal,
      timeoutMs: 30_000,
    });
    await retryGitFetch(
      () =>
        run(
          [
            "git",
            "fetch",
            "--quiet",
            "--no-tags",
            "--depth=1",
            "origin",
            `+refs/heads/${session.branch}:refs/pushdocs/preview`,
          ],
          {
            cwd: workspace,
            env,
            signal,
            timeoutMs: 300_000,
          },
        ),
      {
        onRetry: async (_error, attempt) => {
          await appendLog(
            session.id,
            `\nСоединение с Git оборвалось. Повторяем загрузку (${attempt + 1}/3)…`,
          );
        },
      },
    );
    await run(["git", "checkout", "--quiet", "--detach", "refs/pushdocs/preview"], {
      cwd: workspace,
      env,
      signal,
      timeoutMs: 120_000,
    });
    return { target };
  }

  async function previewState(session: PreviewSession) {
    const [working, attachments] = await Promise.all([
      repository.listChangedWorkingFiles(session.project_id, session.branch),
      repository.listPreviewAttachments(session.project_id, session.branch),
    ]);
    return { attachments, working };
  }

  async function restorePath(workspace: string, relativePath: string): Promise<void> {
    try {
      await run(["git", "-c", "core.hooksPath=/dev/null", "checkout", "--", relativePath], {
        cwd: workspace,
        timeoutMs: 30_000,
      });
    } catch {
      await rm(path.join(workspace, relativePath), { force: true, recursive: true });
    }
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
    const nextPaths = new Set<string>();
    for (const file of working.files) {
      const relativePath = `${prefix}${safePath(file.path)}`;
      nextPaths.add(relativePath);
      const destination = await assertNoSymlink(active.workspace, relativePath);
      if (file.status === "delete") await rm(destination, { force: true, recursive: true });
      else {
        await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
        await writeFile(destination, file.content, { mode: 0o644 });
        await chmod(destination, 0o644);
      }
    }
    for (const attachment of attachments) {
      const relativePath = `${prefix}${safePath(attachment.repository_path)}`;
      nextPaths.add(relativePath);
      const destination = await assertNoSymlink(active.workspace, relativePath);
      const source = path.resolve(attachmentsRoot, attachment.storage_key);
      if (!source.startsWith(`${attachmentsRoot}${path.sep}`))
        throw new Error("Путь вложения выходит за хранилище");
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o755 });
      await rm(destination, { force: true, recursive: true });
      await cp(source, destination);
      await chmod(destination, 0o644);
    }
    for (const previous of active.appliedPaths)
      if (!nextPaths.has(previous)) await restorePath(active.workspace, previous);
    active.appliedPaths = nextPaths;
    return {
      headSha: working.branch.head_commit_sha,
      revision: working.changeSet?.revision ?? 0,
      rootPath: target.root_path,
    };
  }

  async function waitUntilReady(child: ChildProcess, port: number): Promise<void> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error("Процесс предпросмотра завершился при запуске");
      try {
        await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1500) });
        return;
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw new Error("Предпросмотр не открыл порт за 180 секунд");
  }

  async function start(session: PreviewSession): Promise<void> {
    const controller = new AbortController();
    starting.set(session.id, controller);
    const workspace = path.join(workspaceRoot, session.id);
    try {
      await repository.updatePreviewSession(session.id, {
        last_error: null,
        log: "Загружаем выбранную ветку из Git…",
        status: "starting",
      });
      const { target } = await checkout(session, workspace, controller.signal);
      await repository.updatePreviewSession(session.id, {
        log: "Подготавливаем черновики и вложения…",
      });
      const draft = { appliedPaths: new Set<string>(), workspace };
      const state = await applyOverlay(session, draft);
      const rootPath = target.root_path === "." ? "." : safePath(target.root_path);
      const configPath = path.join(workspace, rootPath, ".pushdocs/config.json");
      let config = parseProjectConfig();
      try {
        config = parseProjectConfig(await readFile(configPath, "utf8"));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const preview = config.preview ?? defaultPreview;
      const cwd = path.resolve(workspace, rootPath);
      if (!cwd.startsWith(`${workspace}${path.sep}`) && cwd !== workspace)
        throw new Error("Корень проекта выходит за checkout");
      const runtime = runtimeIdentity(session, workspace);
      await mkdir(runtime.env.HOME, { recursive: true, mode: 0o700 });
      await mkdir(runtime.env.COREPACK_HOME, { recursive: true, mode: 0o700 });
      await run(["chown", "-R", `${runtime.uid}:${runtime.gid}`, workspace], {
        cwd: workspace,
        timeoutMs: 120_000,
      });
      await repository.updatePreviewSession(session.id, {
        log: "Устанавливаем зависимости. Первый запуск может занять несколько минут.",
      });
      const installLog = await run(preview.install, {
        cwd,
        env: runtime.env,
        gid: runtime.gid,
        signal: controller.signal,
        timeoutMs: 10 * 60_000,
        uid: runtime.uid,
      });
      await appendLog(session.id, installLog);
      if (controller.signal.aborted) throw new Error("Запуск предпросмотра отменён");
      await appendLog(session.id, "\nЗапускаем сайт и ждём ответа…");
      const [executable, args] = commandArgs(preview.start, session.port);
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
      };
      running.set(session.id, active);
      const onOutput = (chunk: Buffer) =>
        void appendLog(session.id, chunk.toString()).catch(() => undefined);
      child.stdout?.on("data", onOutput);
      child.stderr?.on("data", onOutput);
      child.on("exit", (code, signal) => {
        if (running.get(session.id) === active) running.delete(session.id);
        if (!active.stopping) {
          void rm(active.workspace, { force: true, recursive: true });
          void repository.updatePreviewSession(session.id, {
            last_error: `Процесс завершился: ${signal ?? code ?? "unknown"}`,
            status: "failed",
          });
        }
      });
      await waitUntilReady(child, session.port);
      await repository.updatePreviewSession(session.id, {
        head_sha: state.headSha,
        revision: state.revision,
        status: "ready",
      });
    } catch (error) {
      const active = running.get(session.id);
      if (active) await stopProcess(session.id, active);
      else await rm(workspace, { force: true, recursive: true });
      const message = error instanceof Error ? error.message : String(error);
      await repository.updatePreviewSession(session.id, { last_error: message, status: "failed" });
      logger.error(JSON.stringify({ error: message, previewSessionId: session.id }));
    } finally {
      starting.delete(session.id);
    }
  }

  async function stopProcess(sessionId: string, active: RunningPreview): Promise<void> {
    active.stopping = true;
    const pid = active.child.pid;
    if (pid) {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        active.child.kill("SIGTERM");
      }
      await Promise.race([
        new Promise<void>((resolve) => active.child.once("exit", () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      ]);
      if (active.child.exitCode === null)
        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          active.child.kill("SIGKILL");
        }
    }
    running.delete(sessionId);
    await rm(active.workspace, { force: true, recursive: true });
  }

  async function tick(): Promise<void> {
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 });
    await repository.reconcilePreviewLeases();
    const sessions = await repository.listPreviewSessions();
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
        if (!active && !starting.has(session.id) && session.status === "queued") {
          void start(session);
          continue;
        }
        if (!active) continue;
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
          await repository.updatePreviewSession(session.id, { revision: updated.revision });
        }
      } catch (error) {
        const active = running.get(session.id);
        if (active) await stopProcess(session.id, active);
        const message = error instanceof Error ? error.message : String(error);
        await repository.updatePreviewSession(session.id, {
          last_error: message,
          status: "failed",
        });
        logger.error(JSON.stringify({ error: message, previewSessionId: session.id }));
      }
    }
  }

  async function stopAll(): Promise<void> {
    await Promise.all([...running].map(([id, active]) => stopProcess(id, active)));
  }

  return { commandArgs, stopAll, tick };
}
