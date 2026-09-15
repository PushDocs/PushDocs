"use client";
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from "react";

function HighlightMatches({ text, query }: { text: string; query: string }) {
  const needle = query.trim();
  if (!needle) return text;
  const expression = new RegExp(needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "giu");
  const parts: ReactNode[] = [];
  let end = 0;
  for (const match of text.matchAll(expression)) {
    parts.push(text.slice(end, match.index));
    parts.push(<mark key={match.index}>{match[0]}</mark>);
    end = match.index + match[0].length;
  }
  parts.push(text.slice(end));
  return parts;
}

export interface FileSearchResult {
  path: string;
  title?: string;
  line?: number;
  excerpt: string;
}

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
        : (path.split("/").at(-1) ?? path);
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
  onSearchContent,
}: {
  paths: string[];
  files: Array<{
    path: string;
    title: string;
    content: string;
    status: string;
    loaded?: boolean;
  }>;
  onOpen: (path: string, line?: number) => void;
  initialContent?: boolean;
  onSearchContent?: (query: string, signal: AbortSignal) => Promise<FileSearchResult[]>;
}) {
  const [query, setQuery] = useState("");
  const [content, setContent] = useState(initialContent);
  const resultId = useId();
  const list = useRef<HTMLDivElement>(null);
  const localResults = useMemo(
    () => searchFiles(paths, files, query, content),
    [paths, files, query, content],
  );
  const hasUnloadedArticles = files.some(
    (file) => file.loaded === false && /\.mdx?$/i.test(file.path) && file.status !== "delete",
  );
  const searchCallback = useRef(onSearchContent);
  useEffect(() => {
    searchCallback.current = onSearchContent;
  }, [onSearchContent]);
  const remoteSearch = hasUnloadedArticles && Boolean(onSearchContent);
  const [remoteResults, setRemoteResults] = useState<FileSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (!content || !query.trim() || !remoteSearch) {
      setRemoteResults([]);
      setSearching(false);
      setSearchError("");
      return;
    }
    setRemoteResults([]);
    setSearching(true);
    setSearchError("");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchCallback
        .current?.(query.trim(), controller.signal)
        .then((results) => {
          if (!controller.signal.aborted) {
            setRemoteResults(results);
            setSearchError("");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setRemoteResults([]);
            setSearchError("Не удалось выполнить поиск. Повторите попытку.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, 180);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [content, query, remoteSearch]);
  const results = content && remoteSearch ? remoteResults : localResults;
  const focusResult = (index: number) => {
    const button = list.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
    button?.focus();
    button?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <div className="quick-open">
      <div className="quick-open-modes">
        <button
          type="button"
          aria-pressed={!content}
          onClick={() => {
            setContent(false);
          }}
        >
          По названию
        </button>
        <button
          type="button"
          aria-pressed={content}
          onClick={() => {
            setContent(true);
          }}
        >
          По тексту
        </button>
      </div>
      <input
        aria-label="Поиск файлов"
        type="search"
        aria-controls={resultId}
        placeholder={content ? "Фраза из статьи…" : "Имя файла…"}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            focusResult(event.key === "ArrowDown" ? 0 : results.length - 1);
          }
          if (event.key === "Enter" && results[0]) {
            event.preventDefault();
            onOpen(results[0].path, results[0].line);
          }
        }}
      />
      <div ref={list} className="quick-open-results">
        <ul id={resultId} aria-label="Результаты поиска">
          {results.map((result, index) => (
            <li key={result.path}>
              <button
                type="button"
                id={`${resultId}-${index}`}
                data-index={index}
                onClick={() => onOpen(result.path, result.line)}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    const next = index + (event.key === "ArrowDown" ? 1 : -1);
                    if (next < 0)
                      list.current?.parentElement
                        ?.querySelector<HTMLInputElement>("input")
                        ?.focus();
                    else focusResult(Math.min(results.length - 1, next));
                  }
                }}
              >
                <strong>
                  {content ? (
                    <HighlightMatches
                      text={result.title || result.path.split("/").at(-1) || result.path}
                      query={query}
                    />
                  ) : (
                    result.path.split("/").at(-1)
                  )}
                </strong>
                <small>
                  {content ? <HighlightMatches text={result.path} query={query} /> : result.path}
                  {result.line ? `:${result.line}` : ""}
                </small>
                {result.excerpt ? (
                  <span>
                    <HighlightMatches text={result.excerpt} query={query} />
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
        {searching ? <p role="status">Ищем по тексту статей…</p> : null}
        {searchError ? <p role="alert">{searchError}</p> : null}
        {!searching && !searchError && !results.length ? (
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
