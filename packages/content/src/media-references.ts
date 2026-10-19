import type { ProjectConfig } from "@pushdocs/contracts";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { mediaLocales, mediaReferenceCandidates, mediaRoots } from "./media-paths";

interface ReferenceNode {
  type: string;
  name?: string | null;
  url?: string;
  value?: string;
  identifier?: string;
  children?: ReferenceNode[];
  attributes?: Array<{
    type: string;
    name?: string;
    value?:
      | string
      | null
      | {
          data?: { estree?: { body: Array<{ expression?: { type: string; value?: unknown } }> } };
        };
  }>;
}

type Reference = { url: string; docMedia: boolean };
const referenceCache = new Map<string, { references: Reference[]; bytes: number }>();
let cacheBytes = 0;

function references(source: string): Reference[] {
  const cached = referenceCache.get(source);
  if (cached) return cached.references;
  const body = source.replace(/^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "");
  let tree: ReferenceNode;
  try {
    tree = unified().use(remarkParse).use(remarkMdx).parse(body) as ReferenceNode;
  } catch {
    // Imported Markdown and unfinished MDX can contain syntax outside the MDX grammar.
    tree = unified().use(remarkParse).parse(body) as ReferenceNode;
  }
  const result: Reference[] = [];
  const definitions = new Map<string, string>();
  function walk(node: ReferenceNode, visit: (node: ReferenceNode) => void) {
    visit(node);
    for (const child of node.children ?? []) walk(child, visit);
  }
  walk(tree, (node) => {
    if (node.type === "definition" && node.identifier && node.url)
      definitions.set(node.identifier.toLowerCase(), node.url);
  });
  walk(tree, (node) => {
    if (["image", "link", "imageReference", "linkReference"].includes(node.type)) {
      const url = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? "");
      if (url) result.push({ url, docMedia: false });
    }
    for (const attribute of node.attributes ?? []) {
      if (attribute.type !== "mdxJsxAttribute" || !["src", "href"].includes(attribute.name ?? ""))
        continue;
      const expression =
        typeof attribute.value === "object"
          ? attribute.value?.data?.estree?.body[0]?.expression
          : undefined;
      const url =
        typeof attribute.value === "string"
          ? attribute.value
          : expression?.type === "Literal" && typeof expression.value === "string"
            ? expression.value
            : undefined;
      if (url) result.push({ url, docMedia: node.name === "DocMedia" && attribute.name === "src" });
    }
    if (node.type === "html") {
      const html = (node.value ?? "").replace(/<!--[\s\S]*?-->/g, "");
      for (const tag of html.matchAll(/<([\w.]+)\b((?:"[^"]*"|'[^']*'|[^'">])*?)>/g))
        for (const attribute of (tag[2] ?? "").matchAll(
          /\s(src|href)\s*=\s*(?:"([^"]*)"|'([^']*)')/g,
        ))
          result.push({
            url: attribute[2] ?? attribute[3] ?? "",
            docMedia: tag[1] === "DocMedia" && attribute[1] === "src",
          });
    }
  });
  const bytes =
    source.length * 2 + result.reduce((total, reference) => total + reference.url.length * 2, 0);
  if (bytes < 8_000_000) {
    referenceCache.set(source, { references: result, bytes });
    cacheBytes += bytes;
    while (cacheBytes > 16_000_000 || referenceCache.size > 2000) {
      const first = referenceCache.entries().next().value;
      if (!first) break;
      referenceCache.delete(first[0]);
      cacheBytes -= first[1].bytes;
    }
  }
  return result;
}

/** Resolve static references once per document, without evaluating repository JavaScript. */
export function mediaUsages(
  config: ProjectConfig,
  paths: string[],
  files: Array<{ path: string; content: string; status: string; locale?: string }>,
) {
  const available = new Set(paths);
  const locales = mediaLocales(config, paths);
  const localeFor = (file: { path: string; locale?: string }) =>
    file.locale && file.locale !== "default"
      ? file.locale
      : (file.path.match(/^i18n\/([^/]+)\//)?.[1] ?? config.defaultLocale);
  const usages = new Map<string, string[]>();
  for (const file of files) {
    if (file.status === "delete" || !/\.mdx?$/i.test(file.path)) continue;
    const locale = localeFor(file);
    const used = new Set<string>();
    const roots = mediaRoots(config, locale, locales);
    for (const reference of references(file.content)) {
      const resolved = mediaReferenceCandidates(
        config,
        locale,
        file.path,
        reference.url,
        reference.docMedia,
        roots,
      ).find((path) => available.has(path));
      if (resolved) used.add(resolved);
    }
    for (const path of used) usages.set(path, [...(usages.get(path) ?? []), file.path]);
  }
  return usages;
}
