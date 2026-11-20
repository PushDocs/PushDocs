"use client";
import { applyEditorInput } from "@pushdocs/content/editing";
import {
  Fragment,
  type RefObject,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
} from "react";

import { EditorWordWrap } from "../lib/editor-settings";
import { useEditorWordWrap } from "./editor-preferences";
import type { SourceEditorHandle } from "./source-editor";

function highlighted(source: string) {
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
  onUndo,
  onRedo,
  readOnly,
  inputRef: handleRef,
  storageKey,
  jump,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onIndent: () => void;
  onUndo?: () => void;
  onRedo?: () => void;
  readOnly: boolean;
  inputRef: RefObject<SourceEditorHandle | null>;
  storageKey?: string;
  jump?: { line: number; token: number };
}) {
  const [wordWrap] = useEditorWordWrap();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const attachInput = useCallback(
    (element: HTMLTextAreaElement | null) => {
      inputRef.current = element;
      handleRef.current = element;
    },
    [handleRef],
  );
  const display = value.replace(/\r\n?/g, "\n");
  const lines = useMemo(
    () => display.split("\n").map((text, index) => ({ number: index + 1, text })),
    [display],
  );
  const tokens = useMemo(
    () =>
      lines.map((line) => ({
        number: line.number,
        content: display.length > 200_000 ? line.text : highlighted(line.text),
      })),
    [display, lines],
  );
  const highlight = useRef<HTMLPreElement>(null);
  const numbers = useRef<HTMLPreElement>(null);
  const syncScroll = useCallback((input: HTMLTextAreaElement) => {
    if (highlight.current)
      highlight.current.style.transform = `translate(${-input.scrollLeft}px, ${-input.scrollTop}px)`;
    if (numbers.current) numbers.current.style.transform = `translateY(${-input.scrollTop}px)`;
  }, []);
  useLayoutEffect(() => {
    const input = inputRef.current;
    const mirror = highlight.current;
    const gutter = numbers.current;
    if (!input || !mirror || !gutter || typeof ResizeObserver === "undefined") return;
    const measure = () => {
      mirror.style.width = `${wordWrap === EditorWordWrap.On ? input.clientWidth : input.scrollWidth}px`;
      const numbers = gutter.querySelectorAll<HTMLElement>(".source-line-number");
      const lines = mirror.querySelectorAll<HTMLElement>(".source-line");
      for (let index = 0; index < tokens.length; index++) {
        const number = numbers[index];
        if (number) number.style.height = `${lines[index]?.getBoundingClientRect().height}px`;
      }
      syncScroll(input);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(input);
    return () => observer.disconnect();
  }, [tokens, wordWrap, syncScroll]);
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
    const target =
      highlight.current?.querySelectorAll<HTMLElement>(".source-line")[
        Math.min(Math.max(0, jump.line - 1), lines.length - 1)
      ];
    const lineHeight = Number.parseFloat(getComputedStyle(input).lineHeight) || 22;
    input.scrollTop = Math.max(
      0,
      target ? target.offsetTop - 2 * lineHeight : (jump.line - 3) * lineHeight,
    );
    syncScroll(input);
  }, [jump, syncScroll]);
  return (
    <div className="source-editor" data-word-wrap={wordWrap}>
      <div className="source-gutter" aria-hidden="true">
        <pre ref={numbers} data-testid="source-lines">
          {lines.map((line) => (
            <Fragment key={line.number}>
              {line.number > 1 ? "\n" : null}
              <span className="source-line-number">{line.number}</span>
            </Fragment>
          ))}
        </pre>
      </div>
      <div className="source-input">
        <pre
          className="source-highlight"
          data-testid="source-highlight"
          ref={highlight}
          aria-hidden="true"
        >
          {tokens.map((line) => (
            <Fragment key={line.number}>
              {line.number > 1 ? "\n" : null}
              <span className="source-line">{line.content}</span>
            </Fragment>
          ))}
        </pre>
        <textarea
          ref={attachInput}
          className="wb-source source-overlay"
          aria-label="Исходник документа"
          wrap={wordWrap === EditorWordWrap.On ? "soft" : "off"}
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
            if (
              (event.metaKey || event.ctrlKey) &&
              !readOnly &&
              onUndo &&
              ["z", "y"].includes(event.key.toLowerCase())
            ) {
              event.preventDefault();
              if (event.shiftKey || event.key.toLowerCase() === "y") onRedo?.();
              else onUndo();
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
