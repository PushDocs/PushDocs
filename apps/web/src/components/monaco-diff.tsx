"use client";
import type { editor } from "monaco-editor";
import { useEffect, useRef, useState } from "react";
import { DiffActions } from "./diff-actions";
import type { ReviewRevertedBlock } from "./diff-revert-history";
import { useEditorWordWrap } from "./editor-preferences";
import { deletedModelLines, equivalentDiffTarget } from "./monaco-diff-targets";
import { editorOptions, fileLanguage, type MonacoApi } from "./monaco-runtime";
import { RevertedDiffActions } from "./reverted-diff-actions";
import {
  type DiffLine,
  type DiffRevertHandler,
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
  revertedBlocks = [],
  onUndo,
}: {
  monaco: MonacoApi;
  before: string;
  after: string;
  path?: string;
  split: boolean;
  showAll: boolean;
  lines?: DiffLine[];
  onRevert?: DiffRevertHandler;
  revertDisabled?: boolean;
  lineHref?: (line: number) => string;
  revealLine?: number;
  revertedBlocks?: ReviewRevertedBlock[];
  onUndo?: (id: string) => void;
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
    left: number;
  }>();
  const [undoHover, setUndoHover] = useState<{
    block: ReviewRevertedBlock;
    top: number;
    left: number;
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
    const leave = () => {
      setHover(undefined);
      setUndoHover(undefined);
    };
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
    if (!diff || (!onRevert && !lineHref && !revertedBlocks.length)) return;
    setHover(undefined);
    setUndoHover(undefined);
    const rows = pairDiffLines(lines);
    const targets = diffLineTargets(lines);
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
          if (
            ![
              monaco.editor.MouseTargetType.CONTENT_TEXT,
              monaco.editor.MouseTargetType.CONTENT_EMPTY,
              monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE,
            ].includes(event.target.type)
          )
            return;
          const position = event.target.position;
          const emptyBlockId =
            event.target.element?.closest<HTMLElement>("[data-reverted-block]")?.dataset
              .revertedBlock;
          const offset = position
            ? diff.getModifiedEditor().getModel()?.getOffsetAt(position)
            : undefined;
          const reverted = revertedBlocks.find(
            (block) =>
              block.id === emptyBlockId ||
              (index === 1 &&
                event.target.type !== monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE &&
                offset !== undefined &&
                offset >= block.start &&
                offset < block.end),
          );
          if (reverted && container.current) {
            const model = diff.getModifiedEditor().getModel();
            const anchor = model?.getPositionAt(reverted.start);
            const visible = anchor && diff.getModifiedEditor().getScrolledVisiblePosition(anchor);
            const top = emptyBlockId
              ? event.target.element?.closest("[data-reverted-block]")?.getBoundingClientRect().top
              : visible
                ? visible.top + (side.getDomNode()?.getBoundingClientRect().top ?? 0)
                : undefined;
            if (top !== undefined) {
              setHover(undefined);
              setUndoHover({
                block: reverted,
                left:
                  (side.getDomNode()?.getBoundingClientRect().left ?? 0) +
                  (visible?.left ?? side.getLayoutInfo().contentLeft) -
                  container.current.getBoundingClientRect().left,
                top: Math.max(0, top - container.current.getBoundingClientRect().top),
              });
            }
            return;
          }
          setUndoHover(undefined);
          if (
            index === 1 &&
            !current.current.split &&
            (event.target.type === monaco.editor.MouseTargetType.CONTENT_VIEW_ZONE ||
              event.target.type === monaco.editor.MouseTargetType.GUTTER_VIEW_ZONE)
          ) {
            // Monaco clamps afterLineNumber to 1 for a zone before the first line.
            const afterLine = event.target.detail.positionBefore?.lineNumber ?? 0;
            const change = diff
              .getLineChanges()
              ?.find(
                (change) =>
                  change.originalEndLineNumber > 0 &&
                  (change.modifiedEndLineNumber === 0
                    ? change.modifiedStartLineNumber
                    : change.modifiedStartLineNumber - 1) === afterLine,
              );
            const zone = event.target.element?.closest(".line-delete");
            const row = event.target.element?.closest(".view-line");
            const original = diff.getOriginalEditor().getModel();
            const originalNumber =
              zone && change && original
                ? deletedModelLines(zone, original, change)?.get(row as Element)
                : undefined;
            const id = originalNumber === undefined ? undefined : numbers[0]?.get(originalNumber);
            const target =
              (id === undefined ? undefined : targets.get(id)) ??
              (change ? equivalentDiffTarget(before, after, lines, change) : undefined);
            if (!target || !container.current) {
              setHover(undefined);
              return;
            }
            const mapping =
              zone && change && original ? deletedModelLines(zone, original, change) : undefined;
            const firstRow =
              mapping && [...mapping].find(([, number]) => number === originalNumber)?.[0];
            const bounds = (firstRow ?? zone)?.getBoundingClientRect();
            const parent = container.current.getBoundingClientRect();
            setHover((previous) => ({
              ...target,
              top:
                previous && previous.lineIds === target.lineIds
                  ? previous.top
                  : Math.max(0, (bounds?.top ?? event.event.browserEvent.clientY) - parent.top),
              left: (bounds?.left ?? parent.left + side.getLayoutInfo().contentLeft) - parent.left,
            }));
            return;
          }
          if (!position) return;
          const id = numbers[index]?.get(position.lineNumber);
          const target = id === undefined ? undefined : targets.get(id);
          if (!target) {
            setHover(undefined);
            return;
          }
          const visible = side.getScrolledVisiblePosition({
            lineNumber: position.lineNumber,
            column: 1,
          });
          if (!visible || !container.current) return;
          const bounds = container.current.getBoundingClientRect();
          const top =
            visible.top + (side.getDomNode()?.getBoundingClientRect().top ?? 0) - bounds.top;
          setHover((previous) =>
            previous?.line === target.line &&
            previous.top === top &&
            previous.lineIds === target.lineIds
              ? previous
              : {
                  ...target,
                  left:
                    visible.left +
                    (side.getDomNode()?.getBoundingClientRect().left ?? 0) -
                    bounds.left,
                  top:
                    previous && previous.lineIds === target.lineIds
                      ? previous.top
                      : Math.max(0, top),
                },
          );
        }),
        side.onDidScrollChange((event) => {
          if (event.scrollTopChanged || event.scrollLeftChanged) {
            setHover(undefined);
            setUndoHover(undefined);
          }
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
            if (ids.length) {
              const position = side.getScrolledVisiblePosition(selection.getStartPosition());
              const bounds = side.getDomNode()?.getBoundingClientRect();
              current.current.onRevert?.(
                ids,
                bounds && position
                  ? new DOMRect(
                      bounds.left + position.left,
                      bounds.top + position.top,
                      0,
                      position.height,
                    )
                  : bounds,
              );
            }
          },
        }),
      ],
    );
    return () => {
      for (const subscription of subscriptions) subscription.dispose();
    };
  }, [monaco, before, after, path, lines, onRevert, lineHref, revertedBlocks]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: Reapply decorations when the diff model is recreated.
  useEffect(() => {
    if (!revertedBlocks.length) return;
    const side = instance.current?.getModifiedEditor();
    const model = side?.getModel();
    if (!side || !model || !revertedBlocks.length) return;
    const decorations = side.createDecorationsCollection(
      revertedBlocks
        .filter((block) => block.end > block.start)
        .map((block) => {
          const start = model.getPositionAt(block.start);
          const end = model.getPositionAt(block.end);
          return {
            range: new monaco.Range(
              start.lineNumber,
              1,
              end.lineNumber - (end.column === 1 ? 1 : 0),
              end.column === 1
                ? model.getLineMaxColumn(Math.max(start.lineNumber, end.lineNumber - 1))
                : end.column,
            ),
            options: { isWholeLine: true, className: "wb-diff-reverted-line" },
          };
        }),
    );
    const zones: string[] = [];
    side.changeViewZones((accessor) => {
      for (const block of revertedBlocks.filter((block) => block.start === block.end)) {
        const position = model.getPositionAt(block.start);
        const node = document.createElement("div");
        node.className = "wb-diff-reverted-empty";
        node.dataset.revertedBlock = block.id;
        node.textContent = "Строки удалены";
        node.addEventListener("mouseenter", () => {
          if (!container.current) return;
          const parent = container.current.getBoundingClientRect();
          const bounds = node.getBoundingClientRect();
          setHover(undefined);
          setUndoHover({ block, top: bounds.top - parent.top, left: bounds.left - parent.left });
        });
        zones.push(
          accessor.addZone({
            afterLineNumber: position.lineNumber - (position.column === 1 ? 1 : 0),
            heightInLines: 1,
            domNode: node,
          }),
        );
      }
    });
    return () => {
      if (instance.current?.getModifiedEditor() !== side) return;
      decorations.clear();
      side.changeViewZones((accessor) => {
        for (const zone of zones) accessor.removeZone(zone);
      });
    };
  }, [monaco, before, after, path, revertedBlocks]);
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
      {undoHover ? (
        <div className="wb-diff-hover-actions" style={{ top: undoHover.top, left: undoHover.left }}>
          <RevertedDiffActions block={undoHover.block} onUndo={onUndo} />
        </div>
      ) : hover ? (
        <div className="wb-diff-hover-actions" style={{ top: hover.top, left: hover.left }}>
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
