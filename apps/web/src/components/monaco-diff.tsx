"use client";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { DiffActions } from "./diff-actions";
import { useEditorWordWrap } from "./editor-preferences";
import { editorOptions, fileLanguage, type MonacoApi } from "./monaco-runtime";
import {
  type DiffLine,
  diffHunks,
  diffLineTargets,
  diffRevertLabels,
  pairDiffLines,
} from "./text-diff";

export function MonacoDiff({
  monaco,
  before,
  after,
  path,
  split,
  showAll,
  lines = [],
  onRevert,
  revertDisabled = false,
  lineHref,
  revealLine,
}: {
  monaco: MonacoApi;
  before: string;
  after: string;
  path?: string;
  split: boolean;
  showAll: boolean;
  lines?: DiffLine[];
  onRevert?: (lineIds: number[]) => void;
  revertDisabled?: boolean;
  lineHref?: (line: number) => string;
  revealLine?: number;
}) {
  const [wordWrap] = useEditorWordWrap();
  const host = useRef<HTMLDivElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const instance = useRef<editor.IStandaloneDiffEditor | null>(null);
  const [hover, setHover] = useState<{
    lineIds: number[];
    hunkIds: number[];
    line: number;
    top: number;
  }>();
  const current = useRef({ split, showAll, wordWrap, onRevert, revertDisabled });
  current.current = { split, showAll, wordWrap, onRevert, revertDisabled };
  useEffect(() => {
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
      domReadOnly: true,
      renderLineHighlight: "none",
      glyphMargin: true,
      lightbulb: { enabled: monaco.editor.ShowLightbulbIconMode.Off },
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
    const element = container.current;
    const leave = () => setHover(undefined);
    element?.addEventListener("mouseleave", leave);
    return () => {
      element?.removeEventListener("mouseleave", leave);
      instance.current = null;
      diff.dispose();
      original.dispose();
      modified.dispose();
    };
  }, [monaco, before, after, path]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reattach controls when the diff instance is recreated.
  useEffect(() => {
    const diff = instance.current;
    if (!diff || (!onRevert && !lineHref)) return;
    setHover(undefined);
    const rows = pairDiffLines(lines);
    const targets = diffLineTargets(lines);
    const hunks = diffHunks(lines);
    const numbers = (["oldNumber", "newNumber"] as const).map(
      (key) =>
        new Map(
          lines.flatMap((line) => {
            const number = line[key];
            return number === undefined ? [] : [[number, line.id] as const];
          }),
        ),
    );
    const subscriptions = [diff.getOriginalEditor(), diff.getModifiedEditor()].flatMap(
      (side, index) => [
        side.onMouseMove((event) => {
          const position = event.target.position;
          if (!position) return;
          if (
            index === 1 &&
            !current.current.split &&
            (event.target.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE ||
              event.target.type === monaco.editor.MouseTargetType.GUTTER_VIEW_ZONE)
          ) {
            const afterLine = event.target.detail.afterLineNumber;
            const hunk = hunks.find((hunk) => hunk.modifiedLine === afterLine + 1);
            if (!hunk || !container.current) {
              setHover(undefined);
              return;
            }
            const bounds = container.current.getBoundingClientRect();
            setHover({
              lineIds: [],
              hunkIds: hunk.lines.map((line) => line.id),
              line: hunk.modifiedLine,
              top: event.event.browserEvent.clientY - bounds.top - 12,
            });
            return;
          }
          const id = numbers[index]?.get(position.lineNumber);
          const target = id === undefined ? undefined : targets.get(id);
          if (!target) {
            setHover(undefined);
            return;
          }
          const visible = side.getScrolledVisiblePosition(position);
          if (!visible || !container.current) return;
          const top =
            visible.top +
            (side.getDomNode()?.getBoundingClientRect().top ?? 0) -
            container.current.getBoundingClientRect().top;
          setHover((previous) =>
            previous?.line === target.line &&
            previous.top === top &&
            previous.lineIds === target.lineIds
              ? previous
              : { ...target, top },
          );
        }),
        side.onDidScrollChange((event) => {
          if (event.scrollTopChanged || event.scrollLeftChanged) setHover(undefined);
        }),
        side.addAction({
          id: "pushdocs.revertSelectedLines",
          label: diffRevertLabels.selection,
          precondition: onRevert ? "editorHasSelection" : "false",
          contextMenuGroupId: "1_modification",
          run: () => {
            if (current.current.revertDisabled) return;
            const selection = side.getSelection();
            if (!selection || selection.isEmpty()) return;
            const end = selection.endLineNumber - (selection.endColumn === 1 ? 1 : 0);
            const ids = rows.flatMap(({ left, right }) => {
              const number = index === 0 ? left?.oldNumber : right?.newNumber;
              if (number === undefined || number < selection.startLineNumber || number > end)
                return [];
              return [left, right].flatMap((line) =>
                line && line.kind !== "context" ? [line.id] : [],
              );
            });
            if (ids.length) current.current.onRevert?.(ids);
          },
        }),
      ],
    );
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [monaco, before, after, path, lines, onRevert, lineHref]);
  useEffect(() => {
    instance.current?.updateOptions({
      renderSideBySide: split,
      wordWrapOverride2: "inherit",
      hideUnchangedRegions: { enabled: !showAll, contextLineCount: 3 },
    });
    setHover(undefined);
  }, [split, showAll]);
  useEffect(() => {
    instance.current?.updateOptions({ wordWrap, diffWordWrap: wordWrap });
  }, [wordWrap]);
  useEffect(() => {
    const diff = instance.current;
    if (!diff || !revealLine) return;
    const reveal = () => diff.getModifiedEditor().revealLineInCenter(revealLine);
    reveal();
    const subscription = diff.onDidUpdateDiff(reveal);
    return () => subscription.dispose();
  }, [revealLine]);
  return (
    <div className="wb-monaco-diff" ref={container} data-testid="monaco-diff">
      <div className="wb-monaco-diff-editor" ref={host} />
      {hover ? (
        <div className="wb-diff-hover-actions" style={{ top: hover.top }}>
          <DiffActions
            lineIds={hover.lineIds}
            hunkIds={hover.hunkIds}
            editHref={lineHref?.(hover.line)}
            onRevert={onRevert}
            disabled={revertDisabled}
          />
        </div>
      ) : null}
    </div>
  );
}
