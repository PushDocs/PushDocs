"use client";

import {
  Children,
  Component,
  isValidElement,
  type ReactNode,
  useId,
  useMemo,
  useState,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkDirective from "remark-directive";
import remarkGfm from "remark-gfm";
import remarkMdx from "remark-mdx";
import { type PreviewContext, preparePreviewSource, previewPlugin } from "./preview-markdown";

export function DocumentPreview({
  source,
  projectId,
  branch,
  path,
  repositoryPaths,
  locale,
  media,
  onErrorLine,
}: PreviewContext & { source: string; onErrorLine?: (line: number) => void }) {
  const plugin = useMemo(
    () => previewPlugin({ projectId, branch, path, repositoryPaths, locale, media }),
    [projectId, branch, path, repositoryPaths, locale, media],
  );
  const prepared = useMemo(() => {
    const lines: number[] = [];
    return { source: preparePreviewSource(source, lines), lines };
  }, [source]);
  return (
    <article className="wb-markdown">
      <PreviewBoundary key={source} onErrorLine={onErrorLine} lineMap={prepared.lines}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm, remarkMdx, remarkDirective, plugin]}
          components={{
            div: ({ node: _node, children, className, ...props }) =>
              className === "wb-preview-tabs" ? (
                <TabsPreview>{children}</TabsPreview>
              ) : (
                <div className={className} {...props}>
                  {children}
                </div>
              ),
          }}
        >
          {prepared.source}
        </ReactMarkdown>
      </PreviewBoundary>
    </article>
  );
}

class PreviewBoundary extends Component<
  { children: ReactNode; onErrorLine?: (line: number) => void; lineMap: number[] },
  { error: boolean; line: number }
> {
  state = { error: false, line: 1 };
  static getDerivedStateFromError(error: {
    line?: number;
    place?: { start?: { line?: number }; line?: number };
  }) {
    return { error: true, line: error.line ?? error.place?.start?.line ?? error.place?.line ?? 1 };
  }
  render() {
    return this.state.error ? (
      <div role="alert">
        <p>
          Не удалось показать превью. Проверьте синтаксис MDX: строка{" "}
          {this.props.lineMap[this.state.line - 1] ?? this.state.line}.
        </p>
        {this.props.onErrorLine ? (
          <button
            type="button"
            onClick={() =>
              this.props.onErrorLine?.(this.props.lineMap[this.state.line - 1] ?? this.state.line)
            }
          >
            Перейти к ошибке
          </button>
        ) : null}
      </div>
    ) : (
      this.props.children
    );
  }
}

function TabsPreview({ children }: { children: ReactNode }) {
  const [selected, setSelected] = useState(0);
  const id = useId();
  const tabs = Children.toArray(children).filter(
    (child) =>
      isValidElement<{ className?: string }>(child) && child.props.className === "wb-preview-tab",
  );
  if (!tabs.length) return <div>{children}</div>;
  return (
    <div className="wb-preview-tabs">
      <div role="tablist" aria-label="Варианты инструкции">
        {tabs.map((tab, index) => (
          <button
            key={isValidElement(tab) ? tab.key : undefined}
            type="button"
            role="tab"
            aria-selected={selected === index}
            id={`${id}-${index}`}
            aria-controls={`${id}-panel`}
            tabIndex={selected === index ? 0 : -1}
            onKeyDown={(event) => {
              const next =
                event.key === "ArrowRight"
                  ? (index + 1) % tabs.length
                  : event.key === "ArrowLeft"
                    ? (index + tabs.length - 1) % tabs.length
                    : event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? tabs.length - 1
                        : undefined;
              if (next === undefined) return;
              event.preventDefault();
              setSelected(next);
              event.currentTarget.parentElement
                ?.querySelectorAll<HTMLButtonElement>("button")
                [next]?.focus();
            }}
            onClick={() => setSelected(index)}
          >
            {isValidElement<{ "data-label"?: string }>(tab) ? tab.props["data-label"] : "Вкладка"}
          </button>
        ))}
      </div>
      <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-${selected}`}>
        {tabs[selected] ?? tabs[0]}
      </div>
    </div>
  );
}
