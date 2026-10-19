import {
  defaultMediaLocations,
  type MediaComponentConfig,
  type ProjectConfig,
} from "@pushdocs/contracts";
import { expand, mediaComponentBaseUrl, mediaPublicUrl, safePath } from "./config";

export interface MediaRoot {
  directory: string;
  publicUrl: string;
  locale: string;
  group: boolean;
  shared: boolean;
  kind?: "images" | "video";
}

export function normalizeMediaPath(value: string) {
  if (value.includes("\\")) return undefined;
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

const encodePath = (value: string) => value.split("/").map(encodeURIComponent).join("/");
const below = (path: string, root: string) => !root || path === root || path.startsWith(`${root}/`);

function localePattern(template: string) {
  if (!template.includes("{locale}")) return undefined;
  const pattern = template
    .replace(/\/+$/, "")
    .split(/(\{locale\})/)
    .map((part) =>
      part === "{locale}" ? "([a-zA-Z0-9_-]+)" : part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return new RegExp(`^${pattern}(?:/|$)`);
}

function matchingLocales(templates: string[], paths: Iterable<string>) {
  const patterns = templates.map(localePattern).filter((pattern): pattern is RegExp => !!pattern);
  const found = new Set<string>();
  for (const path of paths)
    for (const pattern of patterns) {
      const matches = pattern.exec(path)?.slice(1);
      if (matches?.length && new Set(matches).size === 1 && matches[0]) found.add(matches[0]);
    }
  return [...found].sort();
}

/** Discover languages only from configured directory templates, including draft uploads. */
export function mediaLocales(config: ProjectConfig, paths: Iterable<string>) {
  return matchingLocales(
    [
      config.media.images?.directory ?? defaultMediaLocations.images.directory,
      ...(config.media.video ? [config.media.video.directory] : []),
    ],
    paths,
  );
}

export function mediaRoots(
  config: ProjectConfig,
  locale: string,
  knownLocales: string[] = [],
): MediaRoot[] {
  const targets = [...new Set([config.defaultLocale, locale, ...knownLocales])];
  const roots: MediaRoot[] = [];
  for (const kind of ["images", "video"] as const) {
    const configured = config.media[kind];
    const location = configured ?? defaultMediaLocations[kind];
    for (const target of targets) {
      const publicUrl = mediaPublicUrl(config, target, location.publicUrl);
      const directory = safePath(
        expand(location.directory, { locale: target }).replace(/\/+$/, ""),
      );
      roots.push({
        directory,
        publicUrl,
        locale: target,
        group:
          !!configured &&
          (location.directory.includes("{locale}") ||
            (!directory.startsWith("static/") && directory !== "static")),
        shared: !location.directory.includes("{locale}"),
        kind,
      });
    }
  }
  for (const target of targets)
    roots.push({
      directory: "static",
      publicUrl: mediaPublicUrl(config, target, "/{locale}"),
      locale: target,
      group: false,
      shared: true,
    });
  return roots.filter(
    (root, index) =>
      roots.findIndex(
        (candidate) =>
          candidate.directory === root.directory && candidate.publicUrl === root.publicUrl,
      ) === index,
  );
}

export function repositoryMediaUrl(
  config: ProjectConfig,
  locale: string,
  filePath: string,
  roots = mediaRoots(config, locale, mediaLocales(config, [filePath])),
) {
  const root = roots
    .filter((item) => below(filePath, item.directory))
    .sort(
      (a, b) =>
        b.directory.length - a.directory.length ||
        Number(b.locale === locale) - Number(a.locale === locale),
    )[0];
  return root
    ? `${root.publicUrl}/${encodePath(filePath.slice(root.directory.length + 1))}`
    : undefined;
}

export function mediaComponentUrl(
  config: ProjectConfig,
  locale: string,
  src: string,
  component: MediaComponentConfig,
) {
  const base = mediaComponentBaseUrl(config, locale, component);
  if (base === undefined || /^(?:[a-z][\w+.-]*:|\/|@site\/|#)/i.test(src)) return src;
  const path = normalizeMediaPath(`${base}/${src}`);
  return path === undefined ? undefined : `/${path}`;
}

/** A published URL must still point to the selected file after overlay precedence. */
export function mediaAssetLocation(
  config: ProjectConfig,
  locale: string,
  filePath: string,
  available: ReadonlySet<string>,
  roots = mediaRoots(config, locale, mediaLocales(config, available)),
) {
  const url = repositoryMediaUrl(config, locale, filePath, roots);
  const resolved = url
    ? mediaReferenceCandidates(config, locale, "", url, undefined, roots).find((path) =>
        available.has(path),
      )
    : undefined;
  return resolved && resolved !== filePath ? { url: null, shadowedBy: resolved } : { url };
}

/** Ordered exact-path candidates, shared by usages, preview and source completions. */
export function mediaReferenceCandidates(
  config: ProjectConfig,
  locale: string,
  document: string,
  reference: string,
  component?: MediaComponentConfig,
  roots?: MediaRoot[],
) {
  let value = reference.replace(/^pathname:\/\//, "");
  if ((!value && component?.srcBase === undefined) || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(value))
    return [];
  if (component) value = mediaComponentUrl(config, locale, value, component) ?? "";
  try {
    value = decodeURIComponent(value.split(/[?#]/)[0] ?? "");
  } catch {
    return [];
  }
  let candidates: string[];
  if (!value) return [];
  if (value.startsWith("@site/")) candidates = [value.slice(6)];
  else if (!value.startsWith("/"))
    candidates = [`${document.slice(0, document.lastIndexOf("/") + 1)}${value}`, value];
  else {
    const path = normalizeMediaPath(value);
    if (path === undefined) return [];
    const referenceLocales = matchingLocales(
      [
        config.media.images?.publicUrl ?? defaultMediaLocations.images.publicUrl,
        config.media.video?.publicUrl ?? defaultMediaLocations.video.publicUrl,
      ].map((template) => decodeURIComponent(template.replace(/^pathname:\/\//, ""))),
      [`/${path}`],
    );
    const missingLocales = roots
      ? referenceLocales.filter((target) => !roots.some((root) => root.locale === target))
      : [];
    const referenceRoots = roots
      ? [
          ...roots,
          ...(missingLocales.length
            ? mediaRoots(config, locale, missingLocales).filter((root) =>
                missingLocales.includes(root.locale),
              )
            : []),
        ]
      : mediaRoots(config, locale, referenceLocales);
    candidates = referenceRoots
      .flatMap((root, order) => {
        const prefix = normalizeMediaPath(
          decodeURIComponent(root.publicUrl.replace(/^pathname:\/\//, "")),
        );
        return prefix === undefined ? [] : [{ root, order, prefix }];
      })
      .filter(({ prefix }) => below(path, prefix))
      .sort(
        (a, b) =>
          b.prefix.length - a.prefix.length ||
          Number(b.root.locale === locale) - Number(a.root.locale === locale) ||
          a.order - b.order,
      )
      .map(({ root, prefix }) => `${root.directory}/${path.slice(prefix ? prefix.length + 1 : 0)}`);
    candidates.push(path);
  }
  return [
    ...new Set(
      candidates.map(normalizeMediaPath).filter((path): path is string => path !== undefined),
    ),
  ];
}
