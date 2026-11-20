"use client";

import { Columns2, List, UnfoldVertical } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { DiffActions } from "./diff-actions";
import { useDiffLayout } from "./diff-layout";
import { useEditorWordWrap } from "./editor-preferences";
import { MonacoDiff } from "./monaco-diff";
import { useMonaco } from "./monaco-runtime";
import {
  buildTextDiff,
  type DiffLine,
  diffLineTargets,
  foldDiff,
  pairDiffLines,
} from "./text-diff";

export function DiffViewer({
  before,
  after,
  beforeLabel = "Исходный файл",
  afterLabel = "Ваши изменения",
  diff,
  path,
  onRevert,
  revertDisabled = false,
  lineHref,
  revealLine,
}: {
  path?: string;
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
  diff?: ReturnType<typeof buildTextDiff>;
  onRevert?: (lineIds: number[]) => void;
  revertDisabled?: boolean;
  lineHref?: (line: number) => string;
  revealLine?: number;
}) {
  const monaco = useMonaco();
  const [wordWrap] = useEditorWordWrap();
  const [layout, setLayout] = useDiffLayout();
  const [showAll, setShowAll] = useState(!!revealLine);
  const scroll = useRef<HTMLElement>(null);
  const [expanded, setExpanded] = useState<{ before: string; after: string; ids: Set<number> }>({
    before,
    after,
    ids: new Set(),
  });
  const result = useMemo(
    () => (diff === undefined ? buildTextDiff(before, after) : diff),
    [before, after, diff],
  );
  const blocks = useMemo(() => foldDiff(result?.lines ?? []), [result]);
  const targets = useMemo(() => diffLineTargets(result?.lines ?? []), [result]);
  useEffect(() => {
    if (!revealLine) return;
    scroll.current
      ?.querySelector(`[data-new-number="${revealLine}"]`)
      ?.scrollIntoView?.({ block: "center" });
  }, [revealLine]);
  const expandedIds =
    expanded.before === before && expanded.after === after ? expanded.ids : new Set<number>();
  if (!result)
    return <div className="wb-notice">Файл слишком большой для встроенного сравнения.</div>;
  if (!result.added && !result.deleted) return <div className="wb-diff-empty">Нет изменений</div>;

  const actions = (line?: DiffLine) => {
    if (!line || line.kind === "context" || (!onRevert && !lineHref)) return null;
    const target = targets.get(line.id);
    if (!target) return null;
    return (
      <DiffActions
        lineIds={target.lineIds}
        hunkIds={target.hunkIds}
        editHref={lineHref?.(target.line)}
        onRevert={onRevert}
        disabled={revertDisabled}
      />
    );
  };
  const renderLines = (lines: DiffLine[]) =>
    layout === "unified"
      ? lines.map((line) => (
          <div
            className="wb-diff-row"
            data-kind={line.kind}
            data-new-number={line.newNumber}
            key={line.id}
          >
            <span className="wb-diff-number">{line.oldNumber}</span>
            <span className="wb-diff-number">{line.newNumber}</span>
            <LineContent line={line} />
            {actions(line)}
          </div>
        ))
      : pairDiffLines(lines).map(({ left, right }) => (
          <div
            className="wb-diff-pair"
            data-new-number={right?.newNumber}
            key={`${left?.id ?? ""}:${right?.id ?? ""}`}
          >
            {[left, right].map((line, side) => (
              <div
                className="wb-diff-cell"
                data-kind={line?.kind ?? "empty"}
                key={side === 0 ? "before" : "after"}
              >
                <span className="wb-diff-number">
                  {side === 0 ? line?.oldNumber : line?.newNumber}
                </span>
                {line ? <LineContent line={line} /> : <span />}
              </div>
            ))}
            {actions(right ?? left)}
          </div>
        ));

  return (
    <section className="wb-diff" aria-label="Сравнение изменений" data-word-wrap={wordWrap}>
      <header className="wb-diff-toolbar">
        <div className="wb-diff-stats">
          <span role="img" data-kind="add" aria-label={`Добавлено строк: ${result.added}`}>
            +{result.added}
          </span>
          <span role="img" data-kind="delete" aria-label={`Удалено строк: ${result.deleted}`}>
            −{result.deleted}
          </span>
        </div>
        <div className="wb-diff-controls">
          {blocks.some((block) => block.kind === "fold") && (
            <button
              type="button"
              aria-pressed={showAll}
              onClick={() => {
                setShowAll(!showAll);
                if (showAll) setExpanded({ before, after, ids: new Set() });
              }}
            >
              {showAll ? "Только изменения" : "Весь файл"}
            </button>
          )}
          <fieldset className="wb-diff-toggle" aria-label="Вид сравнения">
            <button
              type="button"
              aria-pressed={layout === "unified"}
              onClick={() => setLayout("unified")}
            >
              <List size={14} aria-hidden />
              Единый
            </button>
            <button
              type="button"
              aria-pressed={layout === "split"}
              onClick={() => setLayout("split")}
            >
              <Columns2 size={14} aria-hidden />
              Две колонки
            </button>
          </fieldset>
        </div>
      </header>
      {layout === "split" ? (
        <div className="wb-diff-labels" data-layout={layout}>
          <span>{beforeLabel}</span>
          <span>{afterLabel}</span>
        </div>
      ) : null}
      {monaco && before.replace(/\r\n?/g, "\n") !== after.replace(/\r\n?/g, "\n") ? (
        <MonacoDiff
          monaco={monaco}
          before={before}
          after={after}
          path={path}
          split={layout === "split"}
          showAll={showAll}
          lines={result.lines}
          onRevert={onRevert}
          revertDisabled={revertDisabled}
          lineHref={lineHref}
          revealLine={revealLine}
        />
      ) : (
        /* biome-ignore lint/a11y/noNoninteractiveTabindex: The diff scroll region must support keyboard scrolling. */
        <section className="wb-diff-scroll" ref={scroll} tabIndex={0} aria-label="Строки изменений">
          <div
            className="wb-diff-code"
            data-layout={layout}
            data-actions={!!onRevert || !!lineHref}
          >
            {blocks.map((block) => (
              <Fragment key={block.lines[0]?.id}>
                {block.kind === "fold" && !showAll && !expandedIds.has(block.id) ? (
                  <button
                    className="wb-diff-fold"
                    type="button"
                    onClick={() =>
                      setExpanded({ before, after, ids: new Set([...expandedIds, block.id]) })
                    }
                  >
                    <UnfoldVertical size={14} aria-hidden />
                    Показать строки {block.lines[0]?.oldNumber}–{block.lines.at(-1)?.oldNumber}
                  </button>
                ) : (
                  renderLines(block.lines)
                )}
              </Fragment>
            ))}
          </div>
        </section>
      )}
    </section>
  );
}

function LineContent({ line }: { line: DiffLine }) {
  return (
    <>
      <span
        className="wb-diff-sign"
        role="img"
        aria-hidden={line.kind === "context" || undefined}
        aria-label={
          line.kind === "add" ? "Добавлено" : line.kind === "delete" ? "Удалено" : undefined
        }
      >
        {line.kind === "add" ? "+" : line.kind === "delete" ? "−" : " "}
      </span>
      <code className="wb-diff-text">
        {line.text || " "}
        {line.ending === "none" && (
          <span className="wb-diff-eol"> Нет перевода строки в конце файла</span>
        )}
        {line.ending === "CRLF" && line.kind !== "context" && (
          <span className="wb-diff-eol"> CRLF</span>
        )}
      </code>
    </>
  );
}
