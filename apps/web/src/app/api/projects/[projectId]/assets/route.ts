import { randomBytes } from "node:crypto";
import { mkdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { assetLocation, safePath } from "@pushdocs/content";
import { getDatabase } from "@pushdocs/db";
import { storeUpload } from "@/lib/upload-stream";
import { apiError, assertSameOrigin, workbenchContext } from "@/lib/workbench";

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

export async function POST(request: Request, context: Context) {
  let destination: string | undefined;
  let finish: (() => Promise<void>) | undefined;
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const query = new URL(request.url).searchParams;
    const branch = query.get("branch") ?? "";
    const name = query.get("name") ?? "";
    const { config, user, store, state } = await workbenchContext(projectId, branch);
    await store.requireProjectAccess(user.id, projectId, "document:write");
    if (state.changeSet && state.changeSet.status !== "open")
      throw new Error("Загрузка недоступна во время отправки или конфликта");
    const location = assetLocation(
      config,
      query.get("locale") ?? config.defaultLocale,
      query.get("document") ?? "docs/intro.md",
      name,
    );
    const repositoryPath = safePath(query.get("path") || location.path);
    const root = path.posix.dirname(location.path);
    if (!repositoryPath.startsWith(`${root}/`)) throw new Error("Каталог не разрешён для вложений");
    if (state.branch.repository_paths.includes(repositoryPath) && query.get("replace") !== "true")
      throw new Error("Файл уже существует. Выберите замену явно.");
    const mediaType = mediaTypes[path.extname(repositoryPath).toLowerCase()];
    if (!mediaType || !request.body) throw new Error("Неподдерживаемый файл");
    const maxBytes =
      Math.min(64, Math.max(1, Number(process.env.PUSHDOCS_UPLOAD_LIMIT_MIB) || 64)) * 1024 * 1024;
    if (Number(request.headers.get("content-length")) > maxBytes)
      throw new Error("Файл превышает лимит загрузки");
    const lease = await store.beginUpload({
      projectId,
      branch,
      userId: user.id,
      expectedRevision: Number(query.get("revision")),
    });
    finish = () => store.finishUpload(lease.id, projectId);
    const storageKey = `${projectId}/${randomBytes(20).toString("hex")}`;
    const attachmentsRoot =
      process.env.PUSHDOCS_ATTACHMENTS_DIR ?? path.join(process.cwd(), "data", "attachments");
    destination = path.join(attachmentsRoot, storageKey);
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
      expectedRevision: Number(query.get("revision")),
    });
    const urlRoot = location.url.slice(0, location.url.lastIndexOf("/"));
    return Response.json({
      url: `${urlRoot}/${repositoryPath
        .slice(root.length + 1)
        .split("/")
        .map(encodeURIComponent)
        .join("/")}`,
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
    const attachmentsRoot =
      process.env.PUSHDOCS_ATTACHMENTS_DIR ?? path.join(process.cwd(), "data", "attachments");
    const bytes = asset
      ? await readFile(path.join(attachmentsRoot, asset.storage_key))
      : Buffer.from(
          await provider.readBinary(
            target.provider_repository_id,
            conflict?.theirs_head_sha ?? state.branch.head_commit_sha,
            target.root_path === "." ? filePath : `${target.root_path}/${filePath}`,
          ),
        );
    return new Response(bytes, {
      headers: {
        "Content-Type": mediaType,
        "Content-Security-Policy": "sandbox",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        ...(mediaType === "image/svg+xml" ? { "Content-Disposition": "attachment" } : {}),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
