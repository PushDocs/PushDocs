import type * as Monaco from "monaco-editor";
import { useEffect, useState } from "react";

export type MonacoApi = typeof Monaco;
const assetRoot = "/monaco/0.56.0";
let pending: Promise<MonacoApi> | undefined;

export function loadMonaco(): Promise<MonacoApi> {
  if (pending) return pending;
  pending = new Promise<MonacoApi>((resolve, reject) => {
    const host = window as typeof window & {
      PushDocsMonaco?: MonacoApi;
      MonacoEnvironment?: Monaco.Environment;
    };
    host.MonacoEnvironment = {
      getWorkerUrl: (_moduleId, label) => {
        const worker =
          label === "javascript" || label === "typescript"
            ? "ts"
            : ["css", "scss", "less"].includes(label)
              ? "css"
              : ["html", "handlebars", "razor"].includes(label)
                ? "html"
                : label === "json"
                  ? "json"
                  : "editor";
        return `${assetRoot}/${worker}.worker.js`;
      },
    };
    const style = document.createElement("link");
    style.rel = "stylesheet";
    style.href = `${assetRoot}/editor.css`;
    const script = document.createElement("script");
    script.src = `${assetRoot}/editor.js`;
    script.async = true;
    const failure = () => {
      style.remove();
      script.remove();
      reject(new Error("Не удалось загрузить редактор"));
    };
    const styles = new Promise<void>((ready) => {
      style.onload = () => ready();
    });
    style.onerror = failure;
    script.onerror = failure;
    script.onload = async () => {
      await styles;
      const monaco = host.PushDocsMonaco;
      if (!monaco) return failure();
      monaco.editor.defineTheme("pushdocs", {
        base: "vs",
        inherit: true,
        rules: [],
        colors: {
          "editor.background": "#ffffff",
          "editor.foreground": "#292936",
          "editorLineNumber.foreground": "#8b8b99",
          "editorIndentGuide.background1": "#eeeeF2",
          "editorIndentGuide.activeBackground1": "#d1d1db",
          "editor.lineHighlightBackground": "#f8f8fb",
          "editor.selectionBackground": "#e5dcff",
        },
      });
      resolve(monaco);
    };
    document.head.append(style, script);
  }).catch((error) => {
    pending = undefined;
    throw error;
  });
  return pending;
}

export function useMonaco() {
  const [monaco, setMonaco] = useState<MonacoApi>();
  useEffect(() => {
    let active = true;
    void loadMonaco()
      .then((api) => {
        if (active) setMonaco(api);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return monaco;
}

export function fileLanguage(path = "document.mdx") {
  const extension = path.split(".").at(-1)?.toLowerCase();
  const languages: Record<string, string> = {
    mdx: "mdx",
    md: "markdown",
    markdown: "markdown",
    json: "json",
    jsonc: "json",
    js: "javascript",
    jsx: "javascript",
    mjs: "javascript",
    cjs: "javascript",
    ts: "typescript",
    tsx: "typescript",
    css: "css",
    scss: "scss",
    less: "less",
    html: "html",
    svg: "xml",
    xml: "xml",
    yml: "yaml",
    yaml: "yaml",
    sh: "shell",
    py: "python",
    sql: "sql",
    toml: "ini",
  };
  return languages[extension ?? ""] ?? "plaintext";
}

export const editorOptions: Monaco.editor.IStandaloneEditorConstructionOptions = {
  theme: "pushdocs",
  automaticLayout: true,
  fontFamily: "ui-monospace, SFMono-Regular, Consolas, monospace",
  fontSize: 13,
  lineHeight: 24,
  tabSize: 2,
  insertSpaces: true,
  detectIndentation: true,
  guides: { indentation: true, highlightActiveIndentation: true, bracketPairs: false },
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  renderWhitespace: "selection",
  padding: { top: 16, bottom: 16 },
  lineNumbersMinChars: 3,
  overviewRulerBorder: false,
  stickyScroll: { enabled: false },
  unicodeHighlight: { ambiguousCharacters: false },
};
