"use client";
import { type ReactNode, type RefObject, useEffect, useId, useMemo, useRef, useState } from "react";
import {
  defaultFileSearchOptions,
  type FileSearchOptions,
  fileSearchLimits,
  fileSearchPattern,
} from "@/lib/file-search";
import { defaultFileSearchState, type FileSearchState } from "./file-search-state";

function HighlightMatches({
  text,
  query,
  options,
}: {
  text: string;
  query: string;
  options: FileSearchOptions;
}) {
  const expression = fileSearchPattern(query, options);
  if (!expression) return text;
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
  files: Array<{
    path: string;
    title: string;
    content: string;
    status: string;
    loaded?: boolean;
  }>,
  query: string,
  content: boolean,
  options = defaultFileSearchOptions,
) {
  const expression = fileSearchPattern(query, options);
  const documents = new Map(files.map((file) => [file.path, file]));
  return paths
    .flatMap((path) => {
      const file = documents.get(path);
      if (file?.status === "delete" || (content && file?.loaded === false)) return [];
      const haystack = content
        ? /\.mdx?$/i.test(path)
          ? (file?.content ?? "")
          : ""
        : (path.split("/").at(-1) ?? path);
      if (expression) expression.lastIndex = 0;
      const index = expression ? (expression.exec(haystack)?.index ?? -1) : 0;
      if ((content && !expression) || index < 0) return [];
      const line = content ? haystack.slice(0, index).split("\n").length : undefined;
      return [
        {
          path,
          title: file?.title,
          line,
          excerpt: content
            ? haystack
                .slice(
                  Math.max(0, index - fileSearchLimits.excerptBefore),
                  index + fileSearchLimits.excerptAfter,
                )
                .replace(/\n/g, " ")
            : "",
        },
      ];
    })
    .slice(0, fileSearchLimits.results);
}
export function QuickOpen({
  paths,
  files,
  onOpen,
  initialContent = false,
  onSearchContent,
  searchState,
  onSearchChange,
  selectedPath,
  revision = 0,
  active = true,
  inputRef,
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
  onSearchContent?: (
    query: string,
    signal: AbortSignal,
    options: FileSearchOptions,
  ) => Promise<FileSearchResult[]>;
  searchState?: FileSearchState;
  onSearchChange?: (state: FileSearchState) => void;
  selectedPath?: string;
  revision?: number | string;
  active?: boolean;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [localSearch, setLocalSearch] = useState<FileSearchState>({
    ...defaultFileSearchState,
    content: initialContent,
  });
  const search = searchState ?? localSearch;
  const { query, content, scrollTop, matchCase, wholeWord } = search;
  const searchKey = JSON.stringify([query, matchCase, wholeWord]);
  function updateSearch(update: Partial<FileSearchState>) {
    const next = { ...search, ...update };
    if (onSearchChange) onSearchChange(next);
    else setLocalSearch(next);
  }
  const resultId = useId();
  const list = useRef<HTMLDivElement>(null);
  const localResults = useMemo(
    () => searchFiles(paths, files, query, content, { matchCase, wholeWord }),
    [paths, files, query, content, matchCase, wholeWord],
  );
  const hasUnloadedArticles = files.some(
    (file) => file.loaded === false && /\.mdx?$/i.test(file.path) && file.status !== "delete",
  );
  const searchCallback = useRef(onSearchContent);
  useEffect(() => {
    searchCallback.current = onSearchContent;
  }, [onSearchContent]);
  const remoteSearch = hasUnloadedArticles && Boolean(onSearchContent);
  const [remoteResults, setRemoteResults] = useState({
    key: "",
    revision,
    items: [] as FileSearchResult[],
  });
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  useEffect(() => {
    if (!active || !content || !query.trim() || !remoteSearch) {
      setSearching(false);
      setSearchError("");
      return;
    }
    setSearching(true);
    setSearchError("");
    const controller = new AbortController();
    const timer = setTimeout(() => {
      void searchCallback
        .current?.(query.trim(), controller.signal, { matchCase, wholeWord })
        .then((results) => {
          if (!controller.signal.aborted) {
            setRemoteResults({ key: searchKey, revision, items: results });
            setSearchError("");
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setRemoteResults({ key: searchKey, revision, items: [] });
            setSearchError("Не удалось выполнить поиск. Повторите попытку.");
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setSearching(false);
        });
    }, fileSearchLimits.requestDelay);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [active, content, query, remoteSearch, revision, matchCase, wholeWord, searchKey]);
  const results = useMemo(() => {
    if (!content || !remoteSearch) return localResults;
    const documents = new Map(files.map((file) => [file.path, file]));
    const matches = new Map<string, FileSearchResult>();
    if (remoteResults.key === searchKey) {
      for (const result of remoteResults.items) {
        const file = documents.get(result.path);
        // Loaded bodies (including the editor buffer) take precedence over server matches.
        if (file?.status !== "delete" && (!file || file.loaded === false))
          matches.set(result.path, result);
      }
    }
    for (const result of localResults) matches.set(result.path, result);
    return paths
      .flatMap((path) => {
        const result = matches.get(path);
        return result ? [result] : [];
      })
      .slice(0, fileSearchLimits.results);
  }, [content, remoteSearch, localResults, files, remoteResults, searchKey, paths]);
  useEffect(() => {
    if (active && list.current && results.length) list.current.scrollTop = scrollTop;
  }, [active, results, scrollTop]);
  const focusResult = (index: number) => {
    const button = list.current?.querySelector<HTMLButtonElement>(`[data-index="${index}"]`);
    button?.focus();
    button?.scrollIntoView?.({ block: "nearest" });
  };
  return (
    <div className="quick-open">
      <div className="quick-open-query">
        <input
          ref={inputRef}
          aria-label="Поиск файлов"
          type="search"
          aria-controls={resultId}
          placeholder={content ? "Фраза из статьи…" : "Имя файла…"}
          value={query}
          onChange={(event) => {
            updateSearch({ query: event.target.value, scrollTop: 0 });
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
        <div className="quick-open-options">
          <button
            type="button"
            aria-label="Учитывать регистр"
            title="Учитывать регистр (Match Case)"
            aria-pressed={matchCase}
            onClick={() => updateSearch({ matchCase: !matchCase, scrollTop: 0 })}
          >
            Aa
          </button>
          <button
            type="button"
            aria-label="Слово целиком"
            title="Слово целиком (Match Whole Word)"
            aria-pressed={wholeWord}
            onClick={() => updateSearch({ wholeWord: !wholeWord, scrollTop: 0 })}
          >
            <span className="quick-open-whole-word">ab</span>
          </button>
        </div>
      </div>
      <div className="quick-open-settings">
        <div className="quick-open-modes">
          <button
            type="button"
            aria-pressed={!content}
            onClick={() => {
              updateSearch({ content: false, scrollTop: 0 });
            }}
          >
            По названию
          </button>
          <button
            type="button"
            aria-pressed={content}
            onClick={() => {
              updateSearch({ content: true, scrollTop: 0 });
            }}
          >
            По тексту
          </button>
        </div>
      </div>
      <div
        ref={list}
        className="quick-open-results"
        onScroll={(event) => {
          if (active && event.currentTarget.scrollTop !== scrollTop)
            updateSearch({ scrollTop: event.currentTarget.scrollTop });
        }}
      >
        <ul
          id={resultId}
          aria-label="Результаты поиска"
          aria-busy={
            active &&
            content &&
            Boolean(query.trim()) &&
            remoteSearch &&
            (searching || remoteResults.revision !== revision)
          }
        >
          {results.map((result, index) => (
            <li key={result.path}>
              <button
                type="button"
                id={`${resultId}-${index}`}
                data-index={index}
                aria-current={result.path === selectedPath ? "page" : undefined}
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
                      options={{ matchCase, wholeWord }}
                    />
                  ) : (
                    result.path.split("/").at(-1)
                  )}
                </strong>
                <small>
                  {content ? (
                    <HighlightMatches
                      text={result.path}
                      query={query}
                      options={{ matchCase, wholeWord }}
                    />
                  ) : (
                    result.path
                  )}
                  {result.line ? `:${result.line}` : ""}
                </small>
                {result.excerpt ? (
                  <span>
                    <HighlightMatches
                      text={result.excerpt}
                      query={query}
                      options={{ matchCase, wholeWord }}
                    />
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
        {results.length === fileSearchLimits.results ? (
          <small>Первые {fileSearchLimits.results} результатов. Уточните запрос.</small>
        ) : null}
      </div>
    </div>
  );
}
