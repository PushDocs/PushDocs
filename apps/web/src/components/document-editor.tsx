"use client";

import { Button, Select } from "@pushdocs/ui";
import {
  Bold,
  Check,
  Code2,
  FileImage,
  Heading2,
  Italic,
  Link2,
  List,
  MessageSquarePlus,
  Puzzle,
  Save,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { saveDraftAction } from "@/app/actions";

type EditorMode = "editor" | "source" | "preview";

export function DocumentEditor({
  baseCommitSha,
  branch,
  components,
  initialContent,
  initialRevision,
  path,
  projectId,
  readOnly,
}: {
  baseCommitSha: string;
  branch: string;
  components: Array<{ label: string; name: string; snippet: string }>;
  initialContent: string;
  initialRevision: number;
  path: string;
  projectId: string;
  readOnly: boolean;
}) {
  const [content, setContent] = useState(initialContent);
  const [mode, setMode] = useState<EditorMode>("editor");
  const [state, setState] = useState<"saved" | "dirty" | "saving" | "conflict">("saved");
  const [pending, startTransition] = useTransition();
  const [componentSnippet, setComponentSnippet] = useState(components[0]?.snippet ?? "");
  const lastSaved = useRef(initialContent);
  const latestContent = useRef(initialContent);
  const revisionRef = useRef(initialRevision);
  const saveQueue = useRef<Promise<void>>(Promise.resolve());
  const conflicted = useRef(false);

  useEffect(() => {
    latestContent.current = content;
    if (readOnly || conflicted.current || content === lastSaved.current) return;
    setState("dirty");
    const timeout = window.setTimeout(() => {
      const snapshot = content;
      setState("saving");
      startTransition(async () => {
        const operation = saveQueue.current.then(async () => {
          const formData = new FormData();
          formData.set("baseCommitSha", baseCommitSha);
          formData.set("branch", branch);
          formData.set("content", snapshot);
          formData.set("expectedRevision", String(revisionRef.current));
          formData.set("path", path);
          formData.set("projectId", projectId);
          const result = await saveDraftAction(formData);
          if (result.error === "conflict") {
            conflicted.current = true;
            setState("conflict");
            return;
          }
          const nextRevision = result.revision ?? revisionRef.current + 1;
          revisionRef.current = nextRevision;
          lastSaved.current = snapshot;
          setState(snapshot === latestContent.current ? "saved" : "dirty");
        });
        saveQueue.current = operation.catch(() => undefined);
        await operation;
      });
    }, 1200);
    return () => window.clearTimeout(timeout);
  }, [baseCommitSha, branch, content, path, projectId, readOnly]);

  const insert = (value: string) => {
    if (readOnly) return;
    setContent((current) => `${current}${current.endsWith("\n") ? "" : "\n"}${value}`);
  };

  return (
    <section className="editor-workspace">
      <header className="editor-toolbar">
        <div className="editor-modes" role="tablist" aria-label="Режим редактора">
          {[
            ["editor", "Редактор"],
            ["source", "MDX"],
            ["preview", "Предпросмотр"],
          ].map(([value, label]) => (
            <button
              aria-selected={mode === value}
              className={mode === value ? "active" : ""}
              key={value}
              onClick={() => setMode(value as EditorMode)}
              role="tab"
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        <span className={`save-state save-state--${state}`} aria-live="polite">
          {state === "saved" ? <Check aria-hidden size={14} /> : <Save aria-hidden size={14} />}
          {state === "saved"
            ? "Сохранено в PushDocs"
            : state === "saving" || pending
              ? "Сохраняем…"
              : state === "conflict"
                ? "Есть новая версия"
                : "Есть изменения"}
        </span>
      </header>

      {mode !== "preview" ? (
        <div className="format-toolbar" aria-label="Форматирование" role="toolbar">
          <button
            type="button"
            onClick={() => insert("\n## Новый раздел\n")}
            aria-label="Заголовок"
          >
            <Heading2 aria-hidden size={17} />
          </button>
          <button type="button" onClick={() => insert("**важный текст**")} aria-label="Жирный">
            <Bold aria-hidden size={17} />
          </button>
          <button type="button" onClick={() => insert("_текст_")} aria-label="Курсив">
            <Italic aria-hidden size={17} />
          </button>
          <button
            type="button"
            onClick={() => insert("[ссылка](https://example.test)")}
            aria-label="Ссылка"
          >
            <Link2 aria-hidden size={17} />
          </button>
          <button type="button" onClick={() => insert("\n- пункт\n")} aria-label="Список">
            <List aria-hidden size={17} />
          </button>
          <span className="toolbar-separator" />
          {components.length > 0 ? (
            <span className="component-picker">
              <Select
                label="Компонент MDX"
                onValueChange={setComponentSnippet}
                options={components.map((component) => ({
                  label: component.label,
                  value: component.snippet,
                }))}
                value={componentSnippet}
              />
              <Button
                disabled={readOnly || !componentSnippet}
                onClick={() => insert(`\n${componentSnippet}\n`)}
                tone="ghost"
                type="button"
              >
                <Puzzle aria-hidden size={16} />
                Вставить
              </Button>
            </span>
          ) : (
            <Button disabled tone="ghost" type="button">
              <Puzzle aria-hidden size={16} />
              Нет компонентов
            </Button>
          )}
          <Link className="pd-button pd-button--ghost" href={`/projects/${projectId}/files`}>
            <FileImage aria-hidden size={16} />
            Файл
          </Link>
          <a className="pd-button pd-button--ghost" href="#new-comment">
            <MessageSquarePlus aria-hidden size={16} />
            Комментарий
          </a>
        </div>
      ) : null}

      <div className={mode === "preview" ? "document-canvas preview" : "document-canvas"}>
        {mode === "preview" ? (
          <article className="markdown-preview">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {content.replace(
                /<([A-Z][A-Za-z0-9.]*)\b[^>]*\/>/g,
                "\n\n> 🧩 Компонент **$1** будет отрисован сайтом Docusaurus.\n\n",
              )}
            </ReactMarkdown>
          </article>
        ) : (
          <label className="editor-field">
            <span className="sr-only">
              {mode === "source" ? "Исходник MDX" : "Текст документа"}
            </span>
            <textarea
              className={mode === "source" ? "source-editor" : "prose-editor"}
              onChange={(event) => setContent(event.target.value)}
              readOnly={readOnly}
              spellCheck={mode !== "source"}
              value={content}
            />
          </label>
        )}
      </div>
      {state === "conflict" ? (
        <div className="editor-conflict" role="alert">
          <Code2 aria-hidden size={18} />
          Документ изменился после открытия. Скопируйте свой текст и откройте актуальную версию
          перед объединением.
        </div>
      ) : null}
    </section>
  );
}
