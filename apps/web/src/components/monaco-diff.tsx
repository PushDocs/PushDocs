"use client";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
import { useEditorWordWrap } from "./editor-preferences";
import { editorOptions, fileLanguage, type MonacoApi } from "./monaco-runtime";

export function MonacoDiff({
  monaco,
  before,
  after,
  path,
  split,
  showAll,
}: {
  monaco: MonacoApi;
  before: string;
  after: string;
  path?: string;
  split: boolean;
  showAll: boolean;
}) {
  const [wordWrap] = useEditorWordWrap();
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneDiffEditor | null>(null);
  const current = useRef({ split, showAll, wordWrap });
  current.current = { split, showAll, wordWrap };
  useEffect(() => {
    /* v8 ignore next -- React attaches the host in the same commit before this effect. */
    if (!host.current) return;
    const original = monaco.editor.createModel(before, fileLanguage(path));
    const modified = monaco.editor.createModel(after, fileLanguage(path));
    const diff = monaco.editor.createDiffEditor(host.current, {
      ...editorOptions,
      lineNumbersMinChars:
        String(Math.max(original.getLineCount(), modified.getLineCount())).length + 2,
      wordWrap: current.current.wordWrap,
      diffWordWrap: current.current.wordWrap,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: current.current.split,
      useInlineViewWhenSpaceIsLimited: false,
      ignoreTrimWhitespace: false,
      hideUnchangedRegions: { enabled: !current.current.showAll, contextLineCount: 3 },
      renderOverviewRuler: false,
      diffAlgorithm: "advanced",
      ariaLabel: "Сравнение изменений",
    });
    diff.setModel({ original, modified });
    instance.current = diff;
    return () => {
      instance.current = null;
      diff.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [monaco, before, after, path]);
  useEffect(() => {
    instance.current?.updateOptions({
      renderSideBySide: split,
      // Monaco disables wrapping for the hidden original pane in unified mode.
      wordWrapOverride2: "inherit",
      hideUnchangedRegions: { enabled: !showAll, contextLineCount: 3 },
    });
  }, [split, showAll]);
  useEffect(() => {
    instance.current?.updateOptions({ wordWrap, diffWordWrap: wordWrap });
  }, [wordWrap]);
  return <div className="wb-monaco-diff" ref={host} data-testid="monaco-diff" />;
}
