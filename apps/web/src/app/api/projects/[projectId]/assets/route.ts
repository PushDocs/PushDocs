import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { attachmentUploadDirectory, mediaCatalog, safePath } from "@pushdocs/content";
import { getDatabase } from "@pushdocs/db";
import { storeUpload } from "@/lib/upload-stream";
import {
  apiError,
  assertSameOrigin,
  localWorkbenchContext,
  workbenchContext,
} from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const mediaTypes: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".mp4": "video/mp4",
};

function attachmentPath(storageKey: string) {
  const configuredRoot = process.env.PUSHDOCS_ATTACHMENTS_DIR;
  return configuredRoot
    ? path.join(/*turbopackIgnore: true*/ configuredRoot, storageKey)
    : path.join(process.cwd(), "data", "attachments", storageKey);
}

export async function POST(request: Request, context: Context) {
  let destination: string | undefined;
  let finish: (() => Promise<void>) | undefined;
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const query = new URL(request.url).searchParams;
    const branch = query.get("branch") ?? "";
    const name = query.get("name") ?? "";
    const { config, user, store, state } = await localWorkbenchContext(projectId, branch);
    await store.requireProjectAccess(user.id, projectId, "document:write");
    if (state.changeSet && state.changeSet.status !== "open")
      throw new Error("Загрузка недоступна во время отправки или конфликта");
    const repositoryUpload = query.get("destination") === "repository";
    const document = query.get("document") ?? "docs/intro.md";
    const articleLocale =
      query.get("locale") ??
      state.files?.find((file) => file.path === document)?.locale ??
      document.match(/^i18n\/([^/]+)\//)?.[1] ??
      config.defaultLocale;
    const locale = articleLocale === "default" ? config.defaultLocale : articleLocale;
    const root = repositoryUpload
      ? ""
      : attachmentUploadDirectory(
          config,
          locale,
          ["docmedia", "article", "video"].includes(query.get("mode") ?? "") ? document : undefined,
          query.get("mode") === "video"
            ? "video"
            : query.get("mode") === "docmedia"
              ? "docmedia"
              : undefined,
        );
    const repositoryPath = safePath(query.get("path") || `${root}/${name}`);
    if (!repositoryUpload && !repositoryPath.startsWith(`${root}/`))
      throw new Error("Каталог не разрешён для вложений");
    if (state.branch.repository_paths.includes(repositoryPath) && query.get("replace") !== "true")
      throw new Error("Файл уже существует. Выберите замену явно.");
    const mediaType = mediaTypes[path.extname(repositoryPath).toLowerCase()];
    if (!mediaType || !request.body) throw new Error("Неподдерживаемый файл");
    const maxBytes =
      Math.min(64, Math.max(1, Number(process.env.PUSHDOCS_UPLOAD_LIMIT_MIB) || 64)) * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > maxBytes)
      throw new Error("Файл превышает лимит загрузки");
    const url = repositoryUpload
      ? null
      : (mediaCatalog({
          config,
          locale,
          document,
          paths: [...state.branch.repository_paths, repositoryPath],
          files: [],
          uploads: [],
        }).find((asset) => asset.path === repositoryPath)?.url ?? null);
    const lease = await store.beginUpload({
      projectId,
      branch,
      userId: user.id,
      expectedRevision: Number(query.get("revision")),
    });
    finish = () => store.finishUpload(lease.id, projectId);
    const storageKey = `${projectId}/${randomBytes(20).toString("hex")}`;
    destination = attachmentPath(storageKey);
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    const stored = await storeUpload(request.body, destination, maxBytes);
    await store.recordAttachment({
      branch,
      projectId,
      storageKey,
      repositoryPath,
      originalName: name,
      mediaType,
      sizeBytes: stored.size,
      sha256: stored.sha256,
      createOnly: query.get("replace") !== "true",
      expectedRevision: Number(query.get("revision")),
    });
    return Response.json({
      url,
      path: repositoryPath,
      size: stored.size,
    });
  } catch (error) {
    if (destination) await unlink(destination).catch(() => undefined);
    return apiError(error);
  } finally {
    await finish?.();
  }
}

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const query = new URL(request.url).searchParams;
    const { state, provider, target } = await workbenchContext(
      projectId,
      query.get("branch") ?? "",
    );
    const filePath = safePath(query.get("path") ?? "");
    const asset =
      state.changeSet && query.get("version") !== "git"
        ? await getDatabase()
            .selectFrom("attachments")
            .selectAll()
            .where("project_id", "=", projectId)
            .where("change_set_id", "=", state.changeSet.id)
            .where("repository_path", "=", filePath)
            .executeTakeFirst()
        : undefined;
    const mediaType = mediaTypes[path.extname(filePath).toLowerCase()];
    const conflict =
      state.changeSet?.status === "conflicted" && query.get("version") === "git"
        ? await getDatabase()
            .selectFrom("change_set_conflicts")
            .select(["theirs_content", "theirs_head_sha"])
            .where("change_set_id", "=", state.changeSet.id)
            .where("path", "=", filePath)
            .where("kind", "=", "binary")
            .executeTakeFirst()
        : undefined;
    if (
      !mediaType ||
      (!asset && !conflict?.theirs_content && !state.branch.repository_paths.includes(filePath))
    )
      throw new Error("Вложение не найдено");
    const bytes = asset
      ? await readFile(attachmentPath(asset.storage_key))
      : Buffer.from(
          await provider.readBinary(
            target.provider_repository_id,
            conflict?.theirs_head_sha ?? state.branch.head_commit_sha,
            target.root_path === "." ? filePath : `${target.root_path}/${filePath}`,
          ),
        );
    const headers = new Headers({
      "Content-Type": mediaType,
      "Content-Security-Policy": "sandbox",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, no-store",
      ...(query.get("download") === "true"
        ? {
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.posix.basename(filePath)).replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16)}`)}`,
          }
        : mediaType === "image/svg+xml"
          ? { "Content-Disposition": "attachment" }
          : {}),
    });
    if (mediaType === "video/mp4") {
      headers.set("Accept-Ranges", "bytes");
      const range = request.headers.get("range")?.match(/^bytes=(\d*)-(\d*)$/);
      // Without a matching validator, If-Range requires the complete representation.
      if (range && (range[1] || range[2]) && !request.headers.has("if-range")) {
        const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
        const end =
          range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (start >= bytes.length || end < start) {
          headers.set("Content-Range", `bytes */${bytes.length}`);
          headers.set("Content-Length", "0");
          return new Response(null, { status: 416, headers });
        }
        headers.set("Content-Range", `bytes ${start}-${end}/${bytes.length}`);
        headers.set("Content-Length", String(end - start + 1));
        return new Response(bytes.subarray(start, end + 1), { status: 206, headers });
      }
    }
    headers.set("Content-Length", String(bytes.length));
    return new Response(bytes, { headers });
  } catch (error) {
    return apiError(error);
  }
}
