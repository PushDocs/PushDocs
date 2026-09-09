"use client";

import { Columns2, List, UnfoldVertical } from "lucide-react";
import { Fragment, useMemo, useState } from "react";
import { buildTextDiff, type DiffLine, foldDiff, pairDiffLines } from "./text-diff";

export function DiffViewer({
  before,
  after,
  beforeLabel = "Исходный файл",
  afterLabel = "Ваши изменения",
}: {
  before: string;
  after: string;
  beforeLabel?: string;
  afterLabel?: string;
}) {
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [showAll, setShowAll] = useState(false);
  const [expanded, setExpanded] = useState<{ before: string; after: string; ids: Set<number> }>({
    before,
    after,
    ids: new Set(),
  });
  const result = useMemo(() => buildTextDiff(before, after), [before, after]);
  const blocks = useMemo(() => foldDiff(result?.lines ?? []), [result]);
  const expandedIds =
    expanded.before === before && expanded.after === after ? expanded.ids : new Set<number>();
  if (!result)
    return <div className="wb-notice">Файл слишком большой для встроенного сравнения.</div>;
  if (!result.added && !result.deleted) return <div className="wb-diff-empty">Нет изменений</div>;

  const renderLines = (lines: DiffLine[]) =>
    layout === "unified"
      ? lines.map((line) => (
          <div className="wb-diff-row" data-kind={line.kind} key={line.id}>
            <span className="wb-diff-number">{line.oldNumber}</span>
            <span className="wb-diff-number">{line.newNumber}</span>
            <LineContent line={line} />
          </div>
        ))
      : pairDiffLines(lines).map(({ left, right }) => (
          <div className="wb-diff-pair" key={`${left?.id ?? ""}:${right?.id ?? ""}`}>
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
          </div>
        ));

  return (
    <section className="wb-diff" aria-label="Сравнение изменений">
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
      <div className="wb-diff-labels" data-layout={layout}>
        <span>{beforeLabel}</span>
        <span>{afterLabel}</span>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: The diff scroll region must support keyboard scrolling. */}
      <section className="wb-diff-scroll" tabIndex={0} aria-label="Строки изменений">
        <div className="wb-diff-code" data-layout={layout}>
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
