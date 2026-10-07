import { createHash, randomBytes } from "node:crypto";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { analyzeContent, safePath } from "@pushdocs/content";
import { mediaCatalog } from "@pushdocs/content/media";
import { McpError } from "@pushdocs/db";
import nspell from "nspell";
import sharp from "sharp";
import { optimize } from "svgo";
import { z } from "zod";
import type { ProjectService } from "../project-service";
import { providerForConnection } from "../provider";

const loadDictionaries = () =>
  Promise.all([import("dictionary-en"), import("dictionary-ru")]).then(([en, ru]) => ({
    en: nspell(Buffer.from(en.default.aff), Buffer.from(en.default.dic)),
    ru: nspell(Buffer.from(ru.default.aff), Buffer.from(ru.default.dic)),
  }));
let dictionaryCache: ReturnType<typeof loadDictionaries> | undefined;
function dictionaries() {
  dictionaryCache ??= loadDictionaries();
  return dictionaryCache;
}
function assertStaticSvg(bytes: Uint8Array) {
  const source = Buffer.from(bytes).toString("utf8");
  if (
    /<!DOCTYPE|<!ENTITY|<script|\bon\w+\s*=|(?:href|src)\s*=\s*["'](?!#)|url\(\s*[^#]|<animate|<set\b/i.test(
      source,
    )
  )
    throw new McpError(
      "IMAGE_FORMAT_UNSUPPORTED",
      "Only static SVG without scripts, animation or external references is supported.",
    );
  return source;
}
export async function spelling(
  service: ProjectService,
  projectId: string,
  branch: string,
  filePath: string,
  language?: "ru" | "en",
) {
  const context = await service.document(projectId, branch, filePath),
    dict = await dictionaries();
  const source = context.state.files.find(
    (f) => f.path === ".pushdocs/spelling.json" && f.status !== "delete",
  )?.content;
  const ignored = new Set(
    [
      "pushdocs",
      "sendsay",
      "саблогин",
      "саблогины",
      "webhook",
      ...z
        .object({ ignoredWords: z.array(z.string().max(100)).max(10_000).default([]) })
        .parse(source ? JSON.parse(source) : {}).ignoredWords,
    ].map((w) => w.toLocaleLowerCase()),
  );
  const issues: Array<{
    word: string;
    start: number;
    end: number;
    suggestions: string[];
    type: string;
  }> = [];
  for (const text of analyzeContent(context.file.content).text) {
    // Markdown escapes/entities can change AST text offsets. Only annotate byte-identical spans.
    if (context.file.content.slice(text.start, text.end) !== text.value) continue;
    const prose = text.value.replace(/(?:https?:\/\/|www\.)\S+/g, (url) => " ".repeat(url.length));
    for (const match of prose.matchAll(/[\p{L}][\p{L}\p{N}_'-]*/gu)) {
      const word = match[0],
        lang = /[а-яё]/i.test(word) ? "ru" : "en";
      if (language && language !== lang) continue;
      if (ignored.has(word.toLocaleLowerCase()) || /[\d_]|[a-z][A-Z]|^[A-Z]{2,}$/u.test(word))
        continue;
      if (dict[lang].correct(word)) continue;
      const start = text.start + (match.index ?? 0);
      issues.push({
        word,
        start,
        end: start + word.length,
        suggestions: dict[lang].suggest(word).slice(0, 5),
        type: "spelling",
      });
      if (issues.length >= 300)
        return {
          ...context.snapshot,
          revisionToken: context.revisionToken,
          issues,
          truncated: true,
        };
    }
  }
  return { ...context.snapshot, revisionToken: context.revisionToken, issues, truncated: false };
}
export async function fixSpelling(
  service: ProjectService,
  input: {
    projectId: string;
    branch: string;
    path: string;
    expectedRevision: number;
    revisionToken: string;
    corrections: Array<{ start: number; end: number; word: string; replacement: string }>;
  },
) {
  const context = await service.document(input.projectId, input.branch, input.path);
  if (context.revisionToken !== input.revisionToken)
    throw new McpError("REVISION_CONFLICT", "Reload the document and check spelling again.", 409);
  const available = await spelling(service, input.projectId, input.branch, input.path);
  const corrections = [...input.corrections].sort((a, b) => b.start - a.start);
  let content = context.file.content,
    last = content.length;
  for (const correction of corrections) {
    if (
      correction.start < 0 ||
      correction.end > last ||
      correction.start >= correction.end ||
      content.slice(correction.start, correction.end) !== correction.word ||
      !available.issues.some(
        (i) =>
          i.start === correction.start && i.end === correction.end && i.word === correction.word,
      )
    )
      throw new McpError("INVALID_ARGUMENT", "Correction does not match a spelling issue.");
    content =
      content.slice(0, correction.start) + correction.replacement + content.slice(correction.end);
    last = correction.start;
  }
  return service.update({ ...input, content });
}
function storagePath(key: string) {
  safePath(key);
  const configuredRoot = process.env.PUSHDOCS_ATTACHMENTS_DIR;
  return configuredRoot
    ? path.join(/*turbopackIgnore: true*/ configuredRoot, key)
    : path.join(process.cwd(), "data", "attachments", key);
}
export async function imageBytes(
  service: ProjectService,
  projectId: string,
  branch: string,
  imagePath: string,
) {
  safePath(imagePath);
  const context = await service.context(projectId, branch);
  if (!/\.(png|jpe?g|webp|avif|svg|gif)$/i.test(imagePath))
    throw new McpError("IMAGE_FORMAT_UNSUPPORTED", "Unsupported image extension.");
  if (context.state.files.some((f) => f.path === imagePath && f.status === "delete"))
    throw new McpError("DOCUMENT_NOT_FOUND", "Image was deleted.");
  const upload = (await service.store.listPreviewAttachments(projectId, branch)).find(
    (a) => a.repository_path === imagePath,
  );
  let bytes: Uint8Array;
  if (upload) bytes = await readFile(storagePath(upload.storage_key));
  else {
    if (!context.state.branch.repository_paths.includes(imagePath))
      throw new McpError("DOCUMENT_NOT_FOUND", "Image not found.");
    const target = await service.store.getProjectSyncTarget(projectId);
    if (!target) throw new McpError("PROJECT_NOT_FOUND", "Project not found.");
    const provider = await providerForConnection(target);
    bytes = await provider.readBinary(
      target.provider_repository_id,
      context.snapshot.headCommitSha,
      target.root_path === "." ? imagePath : `${target.root_path}/${imagePath}`,
    );
  }
  if (bytes.length > 64 * 1024 * 1024)
    throw new McpError("INVALID_ARGUMENT", "Image exceeds 64 MiB.");
  return { ...context, bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}
export async function documentImages(
  service: ProjectService,
  projectId: string,
  branch: string,
  filePath: string,
) {
  const context = await service.document(projectId, branch, filePath),
    uploads = await service.store.listPreviewAttachments(projectId, branch);
  const catalog = mediaCatalog({
    config: context.config,
    locale: context.file.locale,
    document: filePath,
    paths: context.state.branch.repository_paths,
    files: context.state.files,
    uploads: uploads.map((a) => ({ path: a.repository_path, size: 0 })),
  });
  const links = analyzeContent(context.file.content).links.filter((l) => l.image);
  const images = [];
  for (const asset of catalog
    .filter(
      (a) =>
        /\.(png|jpe?g|webp|avif|svg|gif)$/i.test(a.path) &&
        a.status !== "delete" &&
        (links.some((l) => l.url.split("#")[0] === a.url) || a.usages.includes(filePath)),
    )
    .slice(0, 100)) {
    const image = await imageBytes(service, projectId, branch, asset.path);
    if (asset.path.toLowerCase().endsWith(".svg")) assertStaticSvg(image.bytes);
    const metadata = await sharp(image.bytes, { limitInputPixels: 40_000_000 }).metadata();
    images.push({
      path: asset.path,
      sha256: image.sha256,
      format: metadata.format,
      width: metadata.width,
      height: metadata.height,
      size: image.bytes.length,
      pages: metadata.pages ?? 1,
      references: asset.usages,
    });
  }
  return { ...context.snapshot, images, truncated: catalog.length > 100 };
}
export async function compressImage(
  service: ProjectService,
  input: {
    projectId: string;
    branch: string;
    imagePath: string;
    expectedRevision: number;
    expectedHash: string;
    quality?: number;
    maxWidth?: number;
    maxHeight?: number;
    minSavingsPercent?: number;
  },
) {
  await service.store.requireProjectAccess(service.userId, input.projectId, "document:write");
  const image = await imageBytes(service, input.projectId, input.branch, input.imagePath);
  if (
    image.sha256 !== input.expectedHash ||
    image.snapshot.changeSetRevision !== input.expectedRevision
  )
    throw new McpError(
      "REVISION_CONFLICT",
      "Image or change set changed. Reload before optimizing.",
      409,
    );
  const svg = input.imagePath.toLowerCase().endsWith(".svg") ? assertStaticSvg(image.bytes) : null;
  const pipeline = sharp(image.bytes, { limitInputPixels: 40_000_000 });
  const metadata = await pipeline.metadata();
  if (
    (metadata.pages ?? 1) > 1 ||
    !["jpeg", "png", "webp", "avif", "svg"].includes(metadata.format ?? "")
  )
    throw new McpError(
      "IMAGE_FORMAT_UNSUPPORTED",
      "Only non-animated JPEG, PNG, WebP, AVIF and static SVG are supported.",
    );
  if (svg && (input.maxWidth || input.maxHeight))
    throw new McpError("IMAGE_FORMAT_UNSUPPORTED", "SVG resizing is not supported.");
  if (input.maxWidth || input.maxHeight)
    pipeline.resize({
      width: input.maxWidth,
      height: input.maxHeight,
      fit: "inside",
      withoutEnlargement: true,
    });
  // Retain orientation and ICC, remove other metadata. No implicit rotation or dimension change.
  pipeline.keepIccProfile();
  if (metadata.orientation)
    pipeline.withExif({ IFD0: { Orientation: String(metadata.orientation) } });
  if (metadata.format === "jpeg") pipeline.jpeg({ quality: input.quality ?? 90, mozjpeg: true });
  if (metadata.format === "png") pipeline.png({ compressionLevel: 9 });
  if (metadata.format === "webp") pipeline.webp({ quality: input.quality ?? 90 });
  if (metadata.format === "avif") pipeline.avif({ quality: input.quality ?? 80, effort: 4 });
  const result = svg
    ? {
        data: Buffer.from(optimize(svg, { multipass: true }).data),
        info: { width: metadata.width, height: metadata.height },
      }
    : await pipeline.toBuffer({ resolveWithObject: true });
  const savedBytes = image.bytes.length - result.data.length,
    savedPercent = (100 * savedBytes) / image.bytes.length;
  const summary = {
    path: input.imagePath,
    oldSize: image.bytes.length,
    newSize: result.data.length,
    savedBytes,
    savedPercent,
    width: result.info.width,
    height: result.info.height,
  };
  if (savedBytes <= 0 || savedPercent < (input.minSavingsPercent ?? 0))
    return {
      ...summary,
      changed: false,
      newSize: image.bytes.length,
      savedBytes: 0,
      savedPercent: 0,
      changeSetRevision: input.expectedRevision,
      width: metadata.width,
      height: metadata.height,
    };
  const lease = await service.store.beginUpload({
    projectId: input.projectId,
    branch: input.branch,
    userId: service.userId,
    expectedRevision: input.expectedRevision,
  });
  const storageKey = `${input.projectId}/${randomBytes(20).toString("hex")}`,
    destination = storagePath(storageKey);
  try {
    await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
    await writeFile(destination, result.data, { flag: "wx", mode: 0o600 });
    await service.store.recordAttachment({
      projectId: input.projectId,
      branch: input.branch,
      repositoryPath: input.imagePath,
      storageKey,
      originalName: path.posix.basename(input.imagePath),
      mediaType: metadata.format === "svg" ? "image/svg+xml" : `image/${metadata.format}`,
      sizeBytes: result.data.length,
      sha256: createHash("sha256").update(result.data).digest("hex"),
      expectedRevision: input.expectedRevision,
      expectedHeadSha: image.snapshot.headCommitSha,
    });
    return { ...summary, changed: true, changeSetRevision: input.expectedRevision + 1 };
  } catch (error) {
    await unlink(destination).catch(() => {});
    throw error;
  } finally {
    await service.store.finishUpload(lease.id, input.projectId);
  }
}
