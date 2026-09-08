"use client";
import { applyEditorInput } from "@pushdocs/content/editing";
import { type RefObject, useMemo, useRef } from "react";

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

export function SourceEditor({
  value,
  onChange,
  onSave,
  onIndent,
  readOnly,
  inputRef,
}: {
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
  onIndent: () => void;
  readOnly: boolean;
  inputRef: RefObject<HTMLTextAreaElement | null>;
}) {
  const display = value.replace(/\r\n?/g, "\n");
  const tokens = useMemo(() => highlighted(display), [display]);
  const highlight = useRef<HTMLPreElement>(null);
  const numbers = useRef<HTMLPreElement>(null);
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
          ref={inputRef}
          className="wb-source source-overlay"
          aria-label="Исходник документа"
          wrap="off"
          value={display}
          readOnly={readOnly}
          spellCheck={false}
          onChange={(event) => onChange(applyEditorInput(value, event.target.value))}
          onScroll={(event) => {
            if (highlight.current)
              highlight.current.style.transform = `translate(${-event.currentTarget.scrollLeft}px, ${-event.currentTarget.scrollTop}px)`;
            if (numbers.current)
              numbers.current.style.transform = `translateY(${-event.currentTarget.scrollTop}px)`;
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
