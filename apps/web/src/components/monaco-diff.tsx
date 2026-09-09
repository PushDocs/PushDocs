"use client";
import type { editor } from "monaco-editor";
import { useEffect, useRef } from "react";
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
  const host = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneDiffEditor | null>(null);
  const current = useRef({ split, showAll });
  current.current = { split, showAll };
  useEffect(() => {
    if (!host.current) return;
    const original = monaco.editor.createModel(before, fileLanguage(path));
    const modified = monaco.editor.createModel(after, fileLanguage(path));
    const diff = monaco.editor.createDiffEditor(host.current, {
      ...editorOptions,
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
      hideUnchangedRegions: { enabled: !showAll, contextLineCount: 3 },
    });
  }, [split, showAll]);
  return <div className="wb-monaco-diff" ref={host} data-testid="monaco-diff" />;
}
