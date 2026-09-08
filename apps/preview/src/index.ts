import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { chmod, mkdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { parseProjectConfig, safePath } from "@pushdocs/content";
import { decryptSecret, getDatabase, PushDocsRepository } from "@pushdocs/db";
import { createProvider } from "@pushdocs/providers";
import {
  containerArguments,
  expiredPreviewIds,
  type PreviewRuntime,
  resolveRuntime,
  snapshotFiles,
  verifyPreviewToken,
} from "./policy";

const database = getDatabase();
const store = new PushDocsRepository(database);
const root = path.resolve(process.env.PUSHDOCS_PREVIEW_DIR ?? "/data/previews");
const volume = process.env.PUSHDOCS_PREVIEW_VOLUME ?? "pushdocs_previews";
const image = process.env.PUSHDOCS_PREVIEW_IMAGE ?? "";
const domain = process.env.PUSHDOCS_PREVIEW_DOMAIN;
const key = process.env.PUSHDOCS_PREVIEW_KEY ?? "";
if ((!image && !process.env.PUSHDOCS_PREVIEW_RUNTIMES) || !domain || !key || key.length < 32)
  throw new Error("Preview image, domain and key (32+ characters) are required");

async function maintainOutputs() {
  const rows = await database
    .selectFrom("preview_builds")
    .select(["id", "project_id as projectId", "branch", "status", "created_at as createdAt"])
    .where("status", "in", ["ready", "failed"])
    .execute();
  for (const id of expiredPreviewIds(rows, new Date()).slice(0, 50)) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid preview id for cleanup");
    await rm(path.join(root, id), { recursive: true, force: true });
    await database
      .deleteFrom("preview_builds")
      .where("id", "=", id)
      .where("status", "in", ["ready", "failed"])
      .execute();
  }
}

// The wrapper contains no credentials and executes only inside the isolated build container.
const wrapper = `
import { cp, readFile, mkdir, readdir, stat, lstat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const config = JSON.parse(await readFile('/control/config.json', 'utf8'));
await cp('/input', '/tmp/site', { recursive: true });
for (const command of [config.install, config.build]) {
  const result = spawnSync(command[0], command.slice(1), { cwd: '/tmp/site', stdio: 'inherit', timeout: 600000, env: { ...process.env, CI: 'true' } });
  if (result.error || result.status !== 0) process.exit(1);
}
const output = path.join('/tmp/site', config.output);
let total = 0;
async function collect(dir) {
  for (const name of await readdir(dir)) {
    const file = path.join(dir, name); const info = await lstat(file);
    if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('Unsafe build output');
    if (info.isDirectory()) await collect(file);
    else { total += info.size; if (total > 268435456) throw new Error('Build output exceeds 256 MiB'); }
  }
}
if (!(await stat(path.join(output, 'index.html'))).isFile()) throw new Error('No index.html in output');
await collect(output);
await cp(output, '/output', { recursive: true });
`;

async function runBuild(id: string, runtime: PreviewRuntime): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      containerArguments(id, runtime.image, volume, process.env.PUSHDOCS_PREVIEW_HOST_DIR, runtime),
      {
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let log = "";
    const capture = (chunk: Buffer) => {
      log = (log + chunk.toString()).slice(-65536);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const progress = setInterval(() => {
      void database
        .updateTable("preview_builds")
        .set({ log, updated_at: new Date() })
        .where("id", "=", id)
        .execute()
        .catch(console.error);
    }, 2000);
    const deadline = setTimeout(() => {
      spawn("docker", ["kill", `pushdocs-preview-${id}`]);
      child.kill("SIGTERM");
    }, runtime.timeoutSeconds * 1000);
    const finish = () => {
      clearTimeout(deadline);
      clearInterval(progress);
    };
    child.on("error", (error) => {
      finish();
      reject(error);
    });
    child.on("close", (code) => {
      finish();
      if (code === 0) resolve(log);
      else reject(new Error(log || `Docker exited: ${code}`));
    });
  });
}

async function nextBuild(): Promise<void> {
  const build = await database.transaction().execute(async (tx) => {
    const row = await tx
      .selectFrom("preview_builds")
      .selectAll()
      .where("status", "=", "queued")
      .orderBy("created_at")
      .forUpdate()
      .skipLocked()
      .executeTakeFirst();
    if (!row) return;
    await tx
      .updateTable("preview_builds")
      .set({ status: "building", updated_at: new Date() })
      .where("id", "=", row.id)
      .execute();
    return row;
  });
  if (!build) return;
  try {
    const target = await store.getProjectSyncTarget(build.project_id);
    if (!target) throw new Error("Project access revoked");
    const provider = createProvider({
      kind: target.kind,
      baseUrl: target.base_url,
      token: decryptSecret(target.secret_encrypted),
    });
    const snapshot = build.snapshot as {
      files: Array<{ path: string; content: string | null }>;
      attachments: Array<{ repository_path: string; storage_key: string }>;
      config: unknown;
    };
    const config = parseProjectConfig(JSON.stringify(snapshot.config));
    const runtime = resolveRuntime(
      build.project_id,
      config.preview.runtime,
      process.env.PUSHDOCS_PREVIEW_RUNTIMES,
      image,
    );
    const prefix = target.root_path === "." ? "" : `${safePath(target.root_path)}/`;
    const paths = (await provider.listFiles(target.provider_repository_id, build.sha)).filter(
      (file) => file.startsWith(prefix),
    );
    if (paths.length > 20000) throw new Error("Snapshot exceeds 20000 files");
    const base = new Map<string, Uint8Array>();
    let total = 0;
    for (let offset = 0; offset < paths.length; offset += 4) {
      const batch = await Promise.all(
        paths.slice(offset, offset + 4).map(async (file) => ({
          path: safePath(file.slice(prefix.length)),
          content: await provider.readBinary(target.provider_repository_id, build.sha, file),
        })),
      );
      for (const file of batch) {
        total += file.content.byteLength;
        if (total > 256 * 1024 * 1024) throw new Error("Snapshot exceeds 256 MiB");
        base.set(file.path, file.content);
      }
    }
    const files = snapshotFiles(base, snapshot.files);
    for (const attachment of snapshot.attachments) {
      const storage = safePath(attachment.storage_key);
      files.set(
        safePath(attachment.repository_path),
        await readFile(
          path.join(process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "/data/attachments", storage),
        ),
      );
    }
    snapshotFiles(files, []);
    const directory = path.join(root, build.id);
    for (const dir of ["input", "control", "output"])
      await mkdir(path.join(directory, dir), { recursive: true });
    await chmod(path.join(directory, "output"), 0o777);
    for (const [file, bytes] of files) {
      const destination = path.join(directory, "input", file);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, bytes, { flag: "wx", mode: 0o644 });
    }
    await writeFile(path.join(directory, "control", "run.mjs"), wrapper, { mode: 0o644 });
    await writeFile(
      path.join(directory, "control", "config.json"),
      JSON.stringify(config.preview),
      { mode: 0o644 },
    );
    const log = await runBuild(build.id, runtime);
    await database
      .updateTable("preview_builds")
      .set({ status: "ready", log, updated_at: new Date() })
      .where("id", "=", build.id)
      .execute();
  } catch (error) {
    await database
      .updateTable("preview_builds")
      .set({ status: "failed", log: String(error).slice(-65536), updated_at: new Date() })
      .where("id", "=", build.id)
      .execute();
  }
}

const types: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
};
createServer(async (request, response) => {
  try {
    if (request.url === "/health") {
      response.end("ok");
      return;
    }
    const host = request.headers.host ?? "";
    const id = host.slice(0, 36);
    if (!/^[a-f0-9-]{36}$/.test(id) || host !== `${id}.${domain}`)
      throw new Error("Unknown preview host");
    const url = new URL(request.url ?? "/", `http://${host}`);
    const cookie = request.headers.cookie
      ?.split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("pushdocs_preview="))
      ?.slice(17)
      ?.split(".");
    const expires = url.searchParams.get("expires") ?? cookie?.[0] ?? "";
    const token = url.searchParams.get("token") ?? cookie?.[1] ?? "";
    if (!verifyPreviewToken(key, id, expires, token)) {
      response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Ссылка истекла. Откройте предпросмотр из PushDocs.");
      return;
    }
    if (url.searchParams.has("token")) {
      response.writeHead(303, {
        Location: url.pathname,
        "Set-Cookie": `pushdocs_preview=${expires}.${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=900${process.env.PUSHDOCS_PREVIEW_SCHEME === "http" ? "" : "; Secure"}`,
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      });
      response.end();
      return;
    }
    const build = await database
      .selectFrom("preview_builds")
      .select("status")
      .where("id", "=", id)
      .executeTakeFirst();
    if (build?.status !== "ready") throw new Error("Preview not ready");
    const base = path.join(root, id, "output");
    let relative = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "index.html";
    relative = relative.replace(/\/$/, "/index.html");
    safePath(relative);
    let candidate = path.join(base, relative);
    try {
      if ((await stat(candidate)).isDirectory()) candidate = path.join(candidate, "index.html");
    } catch {
      if (!path.extname(candidate)) candidate += ".html";
    }
    const resolved = await realpath(candidate);
    if (!resolved.startsWith(`${await realpath(base)}/`)) throw new Error("Unsafe output path");
    response.writeHead(200, {
      "Content-Type": types[path.extname(resolved)] ?? "application/octet-stream",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Cache-Control": "private, no-store",
    });
    createReadStream(resolved)
      .on("error", () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(404);
    response.end("Not found");
  }
}).listen(Number(process.env.PORT ?? 4200), "0.0.0.0");

// A crashed runner must not leave a build shown as running indefinitely.
await database
  .updateTable("preview_builds")
  .set({ status: "failed", log: "Runner was interrupted. Start a new snapshot." })
  .where("status", "=", "building")
  .where("updated_at", "<", new Date(Date.now() - 20 * 60 * 1000))
  .execute();
let nextMaintenance = 0;
for (;;) {
  if (Date.now() >= nextMaintenance) {
    await maintainOutputs().catch(console.error);
    nextMaintenance = Date.now() + 60_000;
  }
  await nextBuild().catch(console.error);
  await new Promise((resolve) => setTimeout(resolve, 2000));
}
