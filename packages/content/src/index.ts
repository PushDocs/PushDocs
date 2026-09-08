import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DocumentSummary } from "@pushdocs/contracts";
import glob from "fast-glob";
import matter from "gray-matter";

export {
  assetLocation,
  isEditableFile,
  parseProjectConfig,
  planDocument,
  planTemplate,
  safePath,
} from "./config";

export interface ImportedDocument extends DocumentSummary {
  content: string;
  contentHash: string;
}

export interface DocusaurusProfile {
  documents: ImportedDocument[];
  locales: string[];
  root: string;
  unknownComponents: string[];
  version: string;
}

const componentPattern = /<([A-Z][A-Za-z0-9.]*)\b/g;

function titleFromContent(content: string, documentPath: string): string {
  // Repository content may use gray-matter's executable engines. Only plain YAML fences are accepted.
  const parsed = /^\uFEFF?---[ \t]*\r?\n/.test(content)
    ? matter(content)
    : { data: {} as Record<string, unknown>, content };
  if (typeof parsed.data.title === "string" && parsed.data.title.trim()) {
    return parsed.data.title.trim();
  }
  const heading = parsed.content.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path
    .basename(documentPath)
    .replace(/\.(md|mdx)$/i, "")
    .replace(/[-_]/g, " ");
}

function localeForPath(documentPath: string): string {
  const match = documentPath.match(/(?:^|\/)i18n\/([^/]+)\//);
  return match?.[1] ?? "default";
}

function versionForPath(documentPath: string): string {
  const match = documentPath.match(
    /(?:^|\/)(?:versioned_docs|i18n\/[^/]+\/docusaurus-plugin-content-docs[^/]*)\/version-([^/]+)\//,
  );
  return match?.[1] ?? "current";
}

export function analyzeDocusaurusFiles(
  files: ReadonlyMap<string, string>,
  rootPath = ".",
): DocusaurusProfile {
  const normalizedRoot = rootPath === "." ? "" : rootPath.replace(/^\/+|\/+$/g, "");
  const prefix = normalizedRoot ? `${normalizedRoot}/` : "";
  const components = new Set<string>();
  const documents: ImportedDocument[] = [];
  for (const [repositoryPath, content] of [...files.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (!repositoryPath.startsWith(prefix)) continue;
    const documentPath = repositoryPath.slice(prefix.length);
    if (
      !/\.(md|mdx)$/i.test(documentPath) ||
      !(
        documentPath.startsWith("docs/") ||
        documentPath.startsWith("versioned_docs/") ||
        /^i18n\/[^/]+\/docusaurus-plugin-content-docs[^/]*\//.test(documentPath)
      )
    ) {
      continue;
    }
    for (const match of content.matchAll(componentPattern)) {
      if (match[1]) components.add(match[1]);
    }
    documents.push({
      content,
      contentHash: createHash("sha256").update(content).digest("hex"),
      locale: localeForPath(documentPath),
      path: documentPath,
      status: "clean",
      title: titleFromContent(content, documentPath),
      version: versionForPath(documentPath),
    });
  }
  return {
    documents,
    locales: [...new Set(documents.map((document) => document.locale))].sort(),
    root: rootPath,
    unknownComponents: [...components].sort(),
    version: "docusaurus",
  };
}

export async function discoverDocusaurusProject(root: string): Promise<DocusaurusProfile> {
  const absoluteRoot = path.resolve(root);
  const files = await glob(
    [
      "docs/**/*.{md,mdx}",
      "versioned_docs/**/*.{md,mdx}",
      "i18n/*/docusaurus-plugin-content-docs*/**/*.{md,mdx}",
    ],
    {
      absolute: false,
      cwd: absoluteRoot,
      dot: false,
      followSymbolicLinks: false,
      onlyFiles: true,
    },
  );
  const contents = new Map(
    await Promise.all(
      files.map(
        async (documentPath) =>
          [documentPath, await readFile(path.join(absoluteRoot, documentPath), "utf8")] as const,
      ),
    ),
  );
  return { ...analyzeDocusaurusFiles(contents), root: absoluteRoot };
}
export { isMediaFile, mediaCatalog } from "./media";
