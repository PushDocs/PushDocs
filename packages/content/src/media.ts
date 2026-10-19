import type { ProjectConfig } from "@pushdocs/contracts";
import { mediaComponentBaseUrl } from "./config";
import { mediaAssetLocation, mediaLocales, mediaRoots, repositoryMediaUrl } from "./media-paths";
import { mediaUsages } from "./media-references";

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");

function relativeLink(document: string, filePath: string) {
  const from = document.split("/").slice(0, -1);
  const to = filePath.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  return "../".repeat(from.length) + encodePath(to.join("/"));
}

export const isMediaFile = (filePath: string) =>
  /\.(png|jpe?g|gif|webp|avif|svg|pdf|zip|csv|txt|mp4)$/i.test(filePath);

export const isDocMediaFile = (filePath: string) =>
  /\.(png|jpe?g|gif|webp|avif|svg|mp4)$/i.test(filePath);

export const isVideoFile = (filePath: string) => /\.mp4$/i.test(filePath);

export function groupMediaAssets<T extends { path: string }>(
  assets: T[],
  directories: string[] = [],
) {
  const groups: Array<{ id: string; label: string; directory?: string; assets: T[] }> = [
    ...new Set(directories),
  ].map((root) => ({
    id: `directory:${root}`,
    label: `Файлы · ${root}`,
    directory: root,
    assets: [],
  }));
  const other = { id: "other", label: "Другие файлы проекта", assets: [] as T[] };
  groups.push(other);
  // A configured parent directory must not absorb a more specific group.
  const roots = groups
    .filter((group) => group.directory)
    .sort((left, right) => (right.directory?.length ?? 0) - (left.directory?.length ?? 0));
  for (const asset of assets) {
    const group = roots.find((root) => asset.path.startsWith(`${root.directory}/`)) ?? other;
    group.assets.push(asset);
  }
  return groups.filter((group) => group.assets.length > 0);
}

export function markdownAttachmentSnippet(asset: { path: string; url: string }) {
  const name = (asset.path.split("/").at(-1) ?? "Файл").replace(/[[\]\\]/g, "");
  const image = /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(asset.path) ? "!" : "";
  const url = `${asset.url.startsWith("/") ? "pathname://" : ""}${asset.url}`
    .replace(/\(/g, "%28")
    .replace(/\)/g, "%29");
  return `${image}[${name}](${url})`;
}

export function videoSnippet(asset: { url: string }) {
  const src = asset.url
    .replace(/^pathname:\/\//, "")
    .replace(
      /[&"<>]/g,
      (character) =>
        ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
    );
  return `<Video src="${src}" />`;
}

export function mediaDisplayPath(filePath: string, directory?: string) {
  return directory && filePath.startsWith(`${directory}/`)
    ? filePath.slice(directory.length + 1)
    : filePath;
}

/** Resolve the configured component source without assuming its repository layout. */
export function docMediaSnippet(
  asset: { path: string; url: string },
  config: ProjectConfig,
  locale: string,
) {
  const url = (repositoryMediaUrl(config, locale, asset.path) ?? asset.url).replace(
    /^pathname:\/\//,
    "",
  );
  if (!url.startsWith("/") || url.startsWith("//"))
    throw new Error("Для вставки DocMedia настройте публичный путь в media.images");
  const publicPath = decodeURIComponent(url).replace(/^\//, "");
  const base = mediaComponentBaseUrl(config, locale, "docmedia");
  const from = decodeURIComponent(base).replace(/^\//, "").split("/").filter(Boolean);
  const to = publicPath.split("/");
  while (from.length && to.length && from[0] === to[0]) {
    from.shift();
    to.shift();
  }
  const src = "../".repeat(from.length) + encodePath(to.join("/"));
  const name = asset.path.split("/").at(-1) ?? "";
  const alt = name.replace(
    /[&"<>]/g,
    (character) =>
      ({ "&": "&amp;", '"': "&quot;", "<": "&lt;", ">": "&gt;" })[character] ?? character,
  );
  return `<DocMedia src="${src}" alt="${alt}" />`;
}

export function mediaCatalog(input: {
  config: ProjectConfig;
  locale: string;
  document: string;
  paths: string[];
  files: Array<{ path: string; content: string; status: string; locale?: string }>;
  uploads: Array<{ path: string; size: number }>;
}) {
  const uploads = new Map(input.uploads.map((file) => [file.path, file.size]));
  const deleted = new Set(
    input.files.filter((file) => file.status === "delete").map((file) => file.path),
  );
  const available = new Set(
    [...input.paths, ...uploads.keys()].filter((path) => !deleted.has(path)),
  );
  const usages = mediaUsages(input.config, [...available], input.files);
  const roots = mediaRoots(input.config, input.locale, mediaLocales(input.config, available));
  return [...new Set([...input.paths, ...uploads.keys()])]
    .filter(isMediaFile)
    .sort()
    .map((filePath) => {
      const location = mediaAssetLocation(input.config, input.locale, filePath, available, roots);
      return {
        path: filePath,
        url: location.shadowedBy ? null : (location.url ?? relativeLink(input.document, filePath)),
        ...(location.shadowedBy ? { shadowedBy: location.shadowedBy } : {}),
        canDelete: true,
        inRepository: input.paths.includes(filePath),
        status: deleted.has(filePath) ? "delete" : uploads.has(filePath) ? "upload" : "clean",
        size: uploads.get(filePath) ?? null,
        usages: usages.get(filePath) ?? [],
      };
    });
}
