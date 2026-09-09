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
}: PreviewContext & { source: string }) {
  const plugin = useMemo(
    () => previewPlugin({ projectId, branch, path, repositoryPaths, locale, media }),
    [projectId, branch, path, repositoryPaths, locale, media],
  );
  return (
    <article className="wb-markdown">
      <PreviewBoundary key={source}>
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
          {preparePreviewSource(source)}
        </ReactMarkdown>
      </PreviewBoundary>
    </article>
  );
}

class PreviewBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? (
      <p role="alert">Не удалось показать превью. Проверьте синтаксис MDX в тексте документа.</p>
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
