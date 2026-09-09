"use client";
import { applyEditorInput } from "@pushdocs/content/editing";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";

import type { SourceEditorHandle } from "./source-editor";

function highlighted(source: string) {
  if (source.length > 200_000) return source;
  const pattern =
    /^#{1,6} .*$|^---$|<\/?[A-Za-z][^>\n]*>|`[^`\n]*`|"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|\b(?:import|from|export|default|const|true|false|null)\b/gm;
  const spans = [];
  let position = 0;
  for (const match of source.matchAll(pattern)) {
    spans.push(source.slice(position, match.index));
    spans.push(
      <span
        key={match.index}
        className={`source-token ${match[0].startsWith("#") ? "source-token-heading" : match[0].startsWith("<") ? "source-token-tag" : "source-token-literal"}`}
      >
        {match[0]}
      </span>,
    );
    position = match.index + match[0].length;
  }
  spans.push(source.slice(position));
  return spans;
}

export function FallbackSourceEditor({
  value,
  onChange,
  onSave,
  onIndent,
  readOnly,
  inputRef: handleRef,
  storageKey,
  jump,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onIndent: () => void;
  readOnly: boolean;
  inputRef: RefObject<SourceEditorHandle | null>;
  storageKey?: string;
  jump?: { line: number; token: number };
}) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInput = useCallback(
    (element: HTMLTextAreaElement | null) => {
      inputRef.current = element;
      handleRef.current = element;
    },
    [handleRef],
  );
  const display = value.replace(/\r\n?/g, "\n");
  const tokens = useMemo(() => highlighted(display), [display]);
  const highlight = useRef<HTMLPreElement>(null);
  const numbers = useRef<HTMLPreElement>(null);
  const syncScroll = useCallback((input: HTMLTextAreaElement) => {
    if (highlight.current)
      highlight.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    if (numbers.current) numbers.current.style.transform = `translateY(${-input.scrollTop}px)`;
  }, []);
  function rememberPosition(input: HTMLTextAreaElement) {
    if (!storageKey) return;
    try {
      sessionStorage.setItem(
        storageKey,
        JSON.stringify({
          start: input.selectionStart,
          end: input.selectionEnd,
          top: input.scrollTop,
          left: input.scrollLeft,
        }),
      );
    } catch {}
  }
  useEffect(() => {
    if (!storageKey || !inputRef.current) return;
    try {
      const position = JSON.parse(sessionStorage.getItem(storageKey) ?? "null");
      if (!position) return;
      const input = inputRef.current;
      input.setSelectionRange(position.start ?? 0, position.end ?? 0);
      input.scrollTop = position.top ?? 0;
      input.scrollLeft = position.left ?? 0;
      syncScroll(input);
    } catch {}
  }, [storageKey, syncScroll]);
  useEffect(() => {
    if (!jump || !inputRef.current) return;
    const input = inputRef.current;
    const lines = input.value.split("\n");
    const offset = lines
      .slice(0, Math.max(0, jump.line - 1))
      .reduce((sum, line) => sum + line.length + 1, 0);
    input.focus();
    input.setSelectionRange(offset, offset);
    input.scrollTop = Math.max(
      0,
      (jump.line - 3) * (Number.parseFloat(getComputedStyle(input).lineHeight) || 22),
    );
    syncScroll(input);
  }, [jump, syncScroll]);
  return (
    <div className="source-editor">
      <div className="source-gutter" aria-hidden="true">
        <pre ref={numbers} data-testid="source-lines">
          {display
            .split("\n")
            .map((_line, index) => index + 1)
            .join("\n")}
        </pre>
      </div>
      <div className="source-input">
        <pre
          className="source-highlight"
          data-testid="source-highlight"
          ref={highlight}
          aria-hidden="true"
        >
          {tokens}
        </pre>
        <textarea
          ref={attachInput}
          className="wb-source source-overlay"
          aria-label="Исходник документа"
          wrap="off"
          value={display}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => onChange(applyEditorInput(value, event.target.value))}
          onSelect={(event) => rememberPosition(event.currentTarget)}
          onScroll={(event) => {
            syncScroll(event.currentTarget);
            rememberPosition(event.currentTarget);
          }}
          onKeyDown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "s") {
              event.preventDefault();
              onSave();
            }
            if (event.key === "Tab" && !readOnly) {
              event.preventDefault();
              onIndent();
            }
          }}
        />
      </div>
    </div>
  );
}
