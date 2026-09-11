"use client";
import { useEffect, useId, useMemo, useRef, useState } from "react";

export function searchFiles(
  paths: string[],
  files: Array<{ path: string; title: string; content: string; status: string }>,
  query: string,
  content: boolean,
) {
  const needle = query.trim().toLocaleLowerCase();
  const documents = new Map(files.map((file) => [file.path, file]));
  return paths
    .flatMap((path) => {
      const file = documents.get(path);
      if (file?.status === "delete") return [];
      const haystack = content
        ? /\.mdx?$/i.test(path)
          ? (file?.content ?? "")
          : ""
        : `${path}\n${file?.title ?? ""}`;
      const index = haystack.toLocaleLowerCase().indexOf(needle);
      if ((content && !needle) || index < 0) return [];
      const line = content ? haystack.slice(0, index).split("\n").length : undefined;
      return [
        {
          path,
          title: file?.title,
          line,
          excerpt: content
            ? haystack.slice(Math.max(0, index - 40), index + 140).replace(/\n/g, " ")
            : "",
        },
      ];
    })
    .slice(0, 100);
}
export function QuickOpen({
  paths,
  files,
  onOpen,
  initialContent = false,
}: {
  paths: string[];
  files: Array<{ path: string; title: string; content: string; status: string }>;
  onOpen: (path: string, line?: number) => void;
  initialContent?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [content, setContent] = useState(initialContent);
  const [selected, setSelected] = useState(0);
  const resultId = useId();
  const list = useRef<HTMLDivElement>(null);
  const results = useMemo(
    () => searchFiles(paths, files, query, content),
    [paths, files, query, content],
  );
  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${selected}"]`)
      ?.scrollIntoView?.({ block: "nearest" });
  }, [selected]);
  return (
    <div className="quick-open">
      <div className="quick-open-modes">
        <button
          type="button"
          aria-pressed={!content}
          onClick={() => {
            setContent(false);
            setSelected(0);
          }}
        >
          Имя или название
        </button>
        <button
          type="button"
          aria-pressed={content}
          onClick={() => {
            setContent(true);
            setSelected(0);
          }}
        >
          Текст статей
        </button>
      </div>
      <input
        aria-label="Поиск файлов"
        role="combobox"
        aria-expanded="true"
        aria-controls={resultId}
        aria-activedescendant={results[selected] ? `${resultId}-${selected}` : undefined}
        aria-autocomplete="list"
        placeholder={content ? "Фраза из статьи…" : "Название статьи или имя файла…"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setSelected(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setSelected((current) =>
              Math.max(
                0,
                Math.min(results.length - 1, current + (event.key === "ArrowDown" ? 1 : -1)),
              ),
            );
          }
          if (event.key === "Enter" && results[selected]) {
            event.preventDefault();
            onOpen(results[selected].path, results[selected].line);
          }
        }}
      />
      {content ? (
        <p className="muted">
          Поиск в импортированных статьях Markdown и MDX текущей ветки. Код и другие файлы не входят
          в поиск.
        </p>
      ) : null}
      <div
        ref={list}
        id={resultId}
        role="listbox"
        className="quick-open-results"
        aria-label="Результаты поиска"
      >
        {results.map((result, index) => (
          <button
            type="button"
            role="option"
            aria-selected={index === selected}
            id={`${resultId}-${index}`}
            data-index={index}
            key={result.path}
            className={index === selected ? "selected" : ""}
            onClick={() => onOpen(result.path, result.line)}
          >
            <strong>{result.title || result.path.split("/").at(-1)}</strong>
            <small>
              {result.path}
              {result.line ? `:${result.line}` : ""}
            </small>
            {result.excerpt ? <span>{result.excerpt}</span> : null}
          </button>
        ))}
        {!results.length ? (
          <p>
            {content && !query.trim()
              ? "Введите текст для поиска в статьях."
              : content
                ? "Совпадений в статьях не найдено."
                : "Файлы не найдены."}
          </p>
        ) : null}
        {results.length === 100 ? <small>Первые 100 результатов. Уточните запрос.</small> : null}
      </div>
    </div>
  );
}
