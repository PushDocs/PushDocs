import { createHash } from "node:crypto";
import path from "node:path";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";
import { readMetadata } from "./metadata";

interface Node {
  type: string;
  value?: string;
  url?: string;
  identifier?: string;
  children?: Node[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}
export interface ContentLink {
  url: string;
  text: string;
  start: number;
  end: number;
  image: boolean;
}
export interface ContentAnalysis {
  links: ContentLink[];
  text: Array<{ value: string; start: number; end: number }>;
  metadata: Record<string, string | number | boolean>;
}
const analyses = new Map<string, { analysis: ContentAnalysis; bytes: number }>();
let analysisBytes = 0;
export function analyzeContent(source: string): ContentAnalysis {
  const key = createHash("sha256").update(source).digest("hex");
  const cached = analyses.get(key);
  if (cached) return cached.analysis;
  const analysis = parseContent(source),
    bytes = Buffer.byteLength(source);
  if (bytes < 8_000_000) {
    analyses.set(key, { analysis, bytes });
    analysisBytes += bytes;
    while (analysisBytes > 16_000_000 || analyses.size > 2000) {
      const first = analyses.entries().next().value;
      if (!first) break;
      analyses.delete(first[0]);
      analysisBytes -= first[1].bytes;
    }
  }
  return analysis;
}
function parseContent(source: string): ContentAnalysis {
  const metadata = readMetadata(source).values;
  const header = /^\uFEFF?---[^\S\r\n]*\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source)?.[0];
  const offset = header?.length ?? 0;
  const tree = unified().use(remarkParse).use(remarkMdx).parse(source.slice(offset)) as Node;
  const result: ContentAnalysis = { links: [], text: [], metadata };
  const definitions = new Map<string, string>();
  const walk = (node: Node, fn: (n: Node) => void) => {
    fn(node);
    for (const child of node.children ?? []) walk(child, fn);
  };
  walk(tree, (n) => {
    if (n.type === "definition" && n.identifier && n.url)
      definitions.set(n.identifier.toLowerCase(), n.url);
  });
  const plain = (n: Node): string => n.value ?? (n.children ?? []).map(plain).join("");
  function visit(node: Node) {
    if (
      [
        "code",
        "inlineCode",
        "mdxjsEsm",
        "mdxFlowExpression",
        "mdxTextExpression",
        "definition",
      ].includes(node.type)
    )
      return;
    const start = (node.position?.start.offset ?? 0) + offset,
      end = (node.position?.end.offset ?? 0) + offset;
    if (["link", "image", "linkReference", "imageReference"].includes(node.type)) {
      const url = node.url ?? definitions.get(node.identifier?.toLowerCase() ?? "");
      if (url)
        result.links.push({
          url,
          text: plain(node),
          start,
          end,
          image: node.type.startsWith("image"),
        });
      if (node.type === "link" && node.url === plain(node)) return;
    }
    if (node.type === "text" && node.value) result.text.push({ value: node.value, start, end });
    for (const child of node.children ?? []) visit(child);
  }
  visit(tree);
  return result;
}
export interface IndexedDocument {
  path: string;
  content: string;
  title: string;
  locale: string;
  version: string;
}
export function resolveDocument(sourcePath: string, href: string, documents: IndexedDocument[]) {
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return { status: "external" as const };
  let clean: string;
  try {
    clean = decodeURIComponent(href.split(/[?#]/, 1)[0] ?? "");
  } catch {
    return { status: "unresolved" as const };
  }
  if (!clean) return { status: "resolved" as const, path: sourcePath };
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(sourcePath), clean));
  const strip = (p: string) => p.replace(/\.(md|mdx)$/i, "").replace(/\/index$/, "");
  const source = documents.find((d) => d.path === sourcePath);
  const matches = documents.filter((d) => {
    if (source && (d.locale !== source.locale || d.version !== source.version)) return false;
    const meta = readMetadata(d.content).values;
    const id = typeof meta.id === "string" ? meta.id : null,
      slug = typeof meta.slug === "string" ? meta.slug : null;
    return clean.startsWith("/")
      ? strip(d.path) === strip(clean.slice(1)) ||
          (slug !== null && clean === slug) ||
          (id !== null && clean === `/docs/${id}`)
      : strip(d.path) === strip(relative) || (id !== null && clean === id);
  });
  return matches.length === 1
    ? { status: "resolved" as const, path: matches[0]?.path }
    : { status: matches.length ? ("ambiguous" as const) : ("unresolved" as const) };
}
export function topicWords(query: string) {
  return [...new Set(query.toLocaleLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [])].filter(
    (w) =>
      ![
        "все",
        "статьи",
        "статья",
        "найди",
        "про",
        "документация",
        "the",
        "and",
        "about",
        "articles",
      ].includes(w),
  );
}
function topicText(source: string) {
  try {
    return analyzeContent(source)
      .text.map((text) => text.value)
      .join(" ");
  } catch {
    // Imported Markdown and partially edited MDX can contain unsupported syntax.
    // Keep their readable text searchable without executing repository code.
    const tree = unified().use(remarkParse).parse(source) as Node;
    const text: string[] = [];
    const visit = (node: Node) => {
      if (node.type === "text" && node.value) text.push(node.value);
      for (const child of node.children ?? []) visit(child);
    };
    visit(tree);
    return text.join(" ");
  }
}
export function searchDocuments(documents: IndexedDocument[], query: string, topic = false) {
  const terms = topic ? topicWords(query) : [query.trim().toLocaleLowerCase()];
  if (!terms.length || !terms[0]) return [];
  return documents
    .flatMap((doc) => {
      const raw = doc.content.toLocaleLowerCase(),
        title = doc.title.toLocaleLowerCase();
      if (!topic && !raw.includes(terms[0] ?? "")) return [];
      const body = topic ? topicText(doc.content).toLocaleLowerCase() : raw;
      const score = terms.reduce(
        (n, t) =>
          n +
          (title.includes(t) ? 5 : 0) +
          (body.includes(t) ? 1 : 0) +
          (topic &&
          body
            .split(/[^\p{L}\p{N}]+/u)
            .some((w) => w.startsWith(t.slice(0, Math.max(4, t.length - 2))))
            ? 0.5
            : 0),
        0,
      );
      if (topic ? score === 0 : !raw.includes(terms[0] ?? "")) return [];
      const at = Math.max(0, raw.indexOf(terms.find((t) => raw.includes(t)) ?? ""));
      return [
        {
          path: doc.path,
          title: doc.title,
          score,
          snippet: doc.content.slice(Math.max(0, at - 60), at + 200),
          line: doc.content.slice(0, at).split("\n").length,
        },
      ];
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path));
}

export function buildLinkIndex(documents: IndexedDocument[]) {
  const strip = (value: string) => value.replace(/\.(md|mdx)$/i, "").replace(/\/index$/, "");
  const scope = (doc: IndexedDocument) => `${doc.locale}\u0000${doc.version}\u0000`;
  const aliases = new Map<string, Set<string>>();
  const add = (key: string, documentPath: string) => {
    const matches = aliases.get(key) ?? new Set<string>();
    matches.add(documentPath);
    aliases.set(key, matches);
  };
  for (const doc of documents) {
    const prefix = scope(doc),
      meta = analyzeContent(doc.content).metadata;
    add(prefix + strip(doc.path), doc.path);
    if (typeof meta.id === "string") {
      add(`${prefix}id:${meta.id}`, doc.path);
      add(`${prefix}docs/${meta.id}`, doc.path);
    }
    if (typeof meta.slug === "string") {
      add(prefix + strip(meta.slug.replace(/^\//, "")), doc.path);
      add(prefix + strip(`docs/${meta.slug.replace(/^\//, "")}`), doc.path);
    }
  }
  const incoming = new Map<
      string,
      Array<{ sourcePath: string; url: string; anchorText: string; snippet: string }>
    >(),
    outgoing = new Map<string, unknown[]>(),
    unresolved: unknown[] = [];
  for (const doc of documents) {
    const edges = [];
    for (const link of analyzeContent(doc.content).links.filter((l) => !l.image)) {
      if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(link.url)) continue;
      let clean: string;
      try {
        clean = decodeURIComponent(link.url.split(/[?#]/, 1)[0] ?? "");
      } catch {
        clean = "\u0000invalid";
      }
      const candidates = new Set<string>();
      if (!clean) candidates.add(doc.path);
      else {
        const keys = clean.startsWith("/")
          ? [strip(clean.slice(1))]
          : [
              strip(path.posix.normalize(path.posix.join(path.posix.dirname(doc.path), clean))),
              `id:${clean}`,
            ];
        for (const key of keys)
          for (const target of aliases.get(scope(doc) + key) ?? []) candidates.add(target);
      }
      const target = candidates.size === 1 ? [...candidates][0] : undefined;
      const item = {
        sourcePath: doc.path,
        url: link.url,
        anchorText: link.text,
        snippet: doc.content.slice(Math.max(0, link.start - 60), link.end + 60),
      };
      edges.push({
        ...item,
        target,
        status: target ? "resolved" : candidates.size ? "ambiguous" : "unresolved",
      });
      if (target) {
        const backlinks = incoming.get(target) ?? [];
        backlinks.push(item);
        incoming.set(target, backlinks);
      } else unresolved.push(item);
    }
    outgoing.set(doc.path, edges);
  }
  return { incoming, outgoing, unresolved };
}
