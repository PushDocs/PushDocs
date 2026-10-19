import { mediaPublicUrl, parseProjectConfig } from "@pushdocs/content/config";
import {
  mediaLocales,
  mediaReferenceCandidates,
  mediaRoots,
  normalizeMediaPath,
} from "@pushdocs/content/media-paths";
import type { ProjectConfig } from "@pushdocs/contracts";
import type { languages } from "monaco-editor";
import type { MonacoApi } from "./monaco-runtime";

interface PathEntry {
  name: string;
  path: string;
  folder: boolean;
}

interface PathCompletionOptions {
  locale?: string;
  defaultLocale?: string;
  media?: ProjectConfig["media"];
  getLineContent?: (lineNumber: number) => string;
}

export function createPathIndex(paths: readonly string[]) {
  const directories = new Map<string, Map<string, PathEntry>>();
  for (const path of paths) {
    const parts = path.split("/");
    if (parts.some((part) => !part || part === "." || part === ".." || part === ".git")) continue;
    let directory = "";
    for (const [index, name] of parts.entries()) {
      const folder = index < parts.length - 1;
      const children = directories.get(directory) ?? new Map<string, PathEntry>();
      directories.set(directory, children);
      if (name !== ".gitkeep") children.set(name, { name, path: `${directory}${name}`, folder });
      directory += `${name}/`;
    }
  }
  return directories;
}

function normalizeDirectory(path: string) {
  const normalized = normalizeMediaPath(path);
  return normalized ? `${normalized}/` : normalized;
}

function mediaSourceComponent(
  beforeQuote: string,
  lineNumber: number,
  getLineContent?: PathCompletionOptions["getLineContent"],
) {
  if (!/\bsrc\s*=\s*\{?\s*$/.test(beforeQuote)) return undefined;
  const lines = [beforeQuote];
  let boundary = /[<>]/.test(beforeQuote);
  for (let previous = lineNumber - 1; previous > 0 && !boundary; previous--) {
    if (!getLineContent) break;
    const line = getLineContent(previous);
    lines.push(line);
    boundary = /[<>]/.test(line);
  }
  return lines
    .reverse()
    .join("\n")
    .match(/<([A-Z]\w*)\b[^<>]*\bsrc\s*=\s*\{?\s*$/)?.[1];
}

function pathAtCursor(
  line: string,
  offset: number,
  lineNumber: number,
  options: PathCompletionOptions,
) {
  const before = line.slice(0, offset);
  // Quoted paths also cover JSX attributes, imports and JSON configuration.
  const quoted = before.match(/(["'])([^"']*)$/);
  const markdown = before.match(/\]\(\s*(<?)([^\s<>)]*)$/);
  const definition = before.match(/^\s*\[[^\]]+\]:\s*(<?)([^\s<>]*)$/);
  let match = markdown ?? definition;
  let quotedPath = false;
  if (quoted && (!match || (quoted.index ?? 0) > (match.index ?? 0))) {
    match = quoted;
    quotedPath = true;
  }
  if (!match) return undefined;
  const value = match[2] ?? "";
  const componentName = quotedPath
    ? mediaSourceComponent(before.slice(0, match.index), lineNumber, options.getLineContent)
    : undefined;
  const component = options.media?.components[componentName ?? ""];
  const pathname = value.startsWith("pathname:///");
  // In ordinary strings, only explicit local paths are relevant.
  if (quotedPath && !component && !pathname && !/^(?:\.{1,2}\/|\/(?!\/)|@site\/)/.test(value))
    return undefined;
  if ((!pathname && /^(?:[a-z][\w+.-]*:|\/\/)/i.test(value)) || /[?#\\]/.test(value))
    return undefined;
  const start = offset - value.length;
  const segmentStart = value.lastIndexOf("/") + 1;
  const after = line.slice(offset);
  const end = after.search(quotedPath ? /[/"'?#]/ : /[\s/<>)]|[?#]/);
  return {
    value,
    directory: value.slice(0, segmentStart),
    prefix: value.slice(segmentStart),
    quoted: quotedPath,
    publicPath: pathname ? "pathname" : component ? "component" : undefined,
    component,
    video: component?.storage === "video",
    start: start + segmentStart,
    end: end < 0 ? line.length : offset + end,
  };
}

export function pathCompletionItems(
  monaco: MonacoApi,
  index: ReturnType<typeof createPathIndex>,
  documentPath: string,
  line: string,
  lineNumber: number,
  column: number,
  options: PathCompletionOptions = {},
): languages.CompletionItem[] {
  const context = pathAtCursor(line, column - 1, lineNumber, options);
  if (!context) return [];
  const documentDirectory = documentPath.slice(0, documentPath.lastIndexOf("/") + 1);
  let directories: string[];
  let prefix: string;
  let insertionPrefix = "";
  const publicFolders: PathEntry[] = [];
  const encoded = !context.quoted || !!context.publicPath;
  try {
    const decodedDirectory = encoded ? decodeURIComponent(context.directory) : context.directory;
    prefix = encoded ? decodeURIComponent(context.prefix) : context.prefix;
    if (context.publicPath) {
      const defaultLocale = options.defaultLocale ?? parseProjectConfig().defaultLocale;
      const locale =
        options.locale && options.locale !== "default"
          ? options.locale
          : (documentPath.match(/^i18n\/([^/]+)\//)?.[1] ?? defaultLocale);
      const config = parseProjectConfig(
        JSON.stringify({
          version: 1,
          defaultLocale,
          ...(options.media ? { media: options.media } : {}),
        }),
      );
      let referenceDirectory = context.directory;
      if (context.component && context.component.srcBase === undefined && !referenceDirectory) {
        const location = config.media[context.component.storage];
        referenceDirectory = location
          ? `${mediaPublicUrl(config, locale, location.publicUrl)}/`
          : "/";
        insertionPrefix = referenceDirectory;
      }
      directories = mediaReferenceCandidates(
        config,
        locale,
        documentPath,
        referenceDirectory,
        context.component,
      ).map((directory) => (directory ? `${directory}/` : ""));
      if (
        context.component &&
        context.component.srcBase === undefined &&
        referenceDirectory.startsWith("/")
      ) {
        const directory = normalizeDirectory(decodeURIComponent(referenceDirectory));
        for (const root of mediaRoots(config, locale, mediaLocales(config, index.keys()))) {
          const publicPath = normalizeDirectory(decodeURIComponent(root.publicUrl));
          if (
            directory === undefined ||
            !publicPath?.startsWith(directory) ||
            !index.has(`${root.directory}/`)
          )
            continue;
          const name = publicPath.slice(directory.length).split("/")[0];
          if (name) publicFolders.push({ name, path: root.directory, folder: true });
        }
      }
    } else {
      const directory = normalizeDirectory(
        context.value.startsWith("@site/")
          ? decodedDirectory.slice(6)
          : context.value.startsWith("/")
            ? decodedDirectory
            : documentDirectory + decodedDirectory,
      );
      directories = directory === undefined ? [] : [directory];
    }
  } catch {
    return [];
  }
  const range = {
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
    startColumn: context.start + 1,
    endColumn: context.end + 1,
  };
  const entries = new Map<string, PathEntry>();
  for (const entry of publicFolders) if (!entries.has(entry.name)) entries.set(entry.name, entry);
  for (const directory of directories)
    for (const entry of index.get(directory)?.values() ?? [])
      if (!entries.has(entry.name)) entries.set(entry.name, entry);
  return [...entries.values()]
    .filter(
      (entry) =>
        entry.name.toLowerCase().startsWith(prefix.toLowerCase()) &&
        (!context.video || entry.folder || /\.mp4$/i.test(entry.name)),
    )
    .sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name))
    .map((entry) => {
      const name = encoded
        ? encodeURIComponent(entry.name).replace(
            /[()']/g,
            (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
          )
        : entry.name;
      const descend = entry.folder && line[context.end] !== "/";
      return {
        label: `${entry.name}${entry.folder ? "/" : ""}`,
        kind: entry.folder
          ? monaco.languages.CompletionItemKind.Folder
          : monaco.languages.CompletionItemKind.File,
        detail: entry.folder ? "Папка" : "Файл",
        documentation: entry.path,
        insertText: `${insertionPrefix}${name}${descend ? "/" : ""}`,
        filterText: name,
        range,
        sortText: `${entry.folder ? "0" : "1"}${entry.name}`,
        ...(descend
          ? { command: { id: "editor.action.triggerSuggest", title: "Открыть папку" } }
          : {}),
      };
    });
}
