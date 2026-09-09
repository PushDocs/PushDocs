"use client";

import { Check, ChevronDown, ChevronRight, Copy, Pencil } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { createProjectComponentAction } from "@/app/actions";
import {
  type CatalogComponent,
  type ComponentExample,
  componentDescription,
} from "./component-examples";
import { DocumentPreview } from "./document-preview";

export function ComponentCatalog({
  components,
  examples,
  projectId,
  branch,
  repositoryPaths,
  canEdit,
}: {
  components: CatalogComponent[];
  examples: Record<string, ComponentExample>;
  projectId: string;
  branch: string;
  repositoryPaths: string[];
  canEdit: boolean;
}) {
  const [adding, setAdding] = useState(false);
  return (
    <section className="component-catalog">
      <header>
        <h2>MDX-компоненты</h2>
      </header>
      <div className="component-list">
        {components.map((component) => (
          <ComponentCard
            key={component.id}
            component={component}
            example={examples[component.name] ?? { snippet: component.snippet }}
            projectId={projectId}
            branch={branch}
            repositoryPaths={repositoryPaths}
            canEdit={canEdit}
          />
        ))}
      </div>
      {canEdit ? (
        <details
          className="component-add"
          open={adding}
          onToggle={(event) => setAdding(event.currentTarget.open)}
        >
          <summary>Добавить шаблон вставки</summary>
          {adding ? (
            <ComponentForm
              projectId={projectId}
              branch={branch}
              repositoryPaths={repositoryPaths}
              onCancel={() => setAdding(false)}
            />
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

function ComponentCard({
  component,
  example,
  projectId,
  branch,
  repositoryPaths,
  canEdit,
}: {
  component: CatalogComponent;
  example: ComponentExample;
  projectId: string;
  branch: string;
  repositoryPaths: string[];
  canEdit: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const description = componentDescription(component.description);
  return (
    <details className="component-card" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <ChevronDown aria-hidden size={16} />
        <span>
          <code>{component.name}</code>
          {component.label !== component.name ? <strong>{component.label}</strong> : null}
          {description ? <small>{description}</small> : null}
        </span>
      </summary>
      {open ? (
        <div className="component-card-body">
          {!editing ? (
            <div className="component-examples">
              <section>
                <header>
                  <h3>Пример вставки</h3>
                  <button
                    className="pd-button pd-button--secondary"
                    type="button"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(example.snippet);
                        setCopied(true);
                        setCopyError(false);
                      } catch {
                        setCopyError(true);
                      }
                    }}
                  >
                    {copied ? <Check aria-hidden size={14} /> : <Copy aria-hidden size={14} />}
                    {copied ? "Скопировано" : "Копировать"}
                  </button>
                </header>
                <pre>
                  <code>{example.snippet}</code>
                </pre>
                {copyError ? <p role="alert">Выделите и скопируйте код вручную.</p> : null}
              </section>
              <section>
                <header>
                  <h3>Превью</h3>
                </header>
                <div className="component-preview">
                  <DocumentPreview
                    source={example.snippet}
                    projectId={projectId}
                    branch={branch}
                    path={example.path ?? "docs/example.mdx"}
                    repositoryPaths={repositoryPaths}
                  />
                </div>
              </section>
            </div>
          ) : null}
          {!editing ? (
            <footer>
              {example.path ? (
                <Link
                  href={`/projects/${projectId}/documents?${new URLSearchParams({ branch, path: example.path })}`}
                >
                  {example.path}
                </Link>
              ) : null}
              <Link href={`/projects/${projectId}/preview?${new URLSearchParams({ branch })}`}>
                Открыть на сайте
              </Link>
              {canEdit ? (
                <button
                  className="pd-button pd-button--secondary"
                  type="button"
                  onClick={() => setEditing(!editing)}
                >
                  <Pencil aria-hidden size={14} />
                  Изменить шаблон вставки
                </button>
              ) : null}
            </footer>
          ) : null}
          {editing ? (
            <ComponentForm
              projectId={projectId}
              branch={branch}
              repositoryPaths={repositoryPaths}
              path={example.path}
              onCancel={() => setEditing(false)}
              component={{ ...component, description, snippet: example.snippet }}
            />
          ) : null}
        </div>
      ) : null}
    </details>
  );
}

function ComponentForm({
  projectId,
  branch,
  repositoryPaths,
  path,
  component,
  onCancel,
}: {
  projectId: string;
  branch: string;
  repositoryPaths: string[];
  path?: string;
  component?: CatalogComponent;
  onCancel: () => void;
}) {
  const [snippet, setSnippet] = useState(
    component?.snippet ??
      "import SupportLink from '@site/src/components/SupportLink';\n\n<SupportLink>Написать в поддержку</SupportLink>",
  );
  const [label, setLabel] = useState(component?.label ?? "Ссылка в поддержку");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setSaved(false);
        setError("");
        try {
          await createProjectComponentAction(data);
          setSaved(true);
        } catch {
          setError("Не удалось сохранить шаблон. Проверьте поля и повторите попытку.");
        } finally {
          setBusy(false);
        }
      }}
      className="component-form component-template-form"
    >
      <header className="wide-field">
        {component ? <h3>Шаблон для меню «Компонент»</h3> : null}
        <p>Сохраните код существующего компонента, чтобы вставлять его в статьи одним нажатием.</p>
      </header>
      <input name="projectId" type="hidden" value={projectId} />
      <label className="wide-field">
        Название в меню
        <input
          name="label"
          value={label}
          onChange={(event) => {
            setLabel(event.target.value);
            setSaved(false);
          }}
          required
          disabled={busy}
        />
      </label>
      <div className="component-menu-example wide-field">
        <span>Редактор</span>
        <ChevronRight aria-hidden size={14} />
        <span>Компонент</span>
        <ChevronRight aria-hidden size={14} />
        <strong>{label || "Название шаблона"}</strong>
      </div>
      <div className="component-examples wide-field">
        <section>
          <header>
            <h3>
              <label htmlFor={`template-code-${component?.id ?? "new"}`}>
                Код для вставки в статью
              </label>
            </h3>
          </header>
          <textarea
            id={`template-code-${component?.id ?? "new"}`}
            name="snippet"
            value={snippet}
            onChange={(event) => {
              setSnippet(event.target.value);
              setSaved(false);
            }}
            required
            disabled={busy}
            spellCheck={false}
          />
        </section>
        <section>
          <header>
            <h3>Как выглядит в статье</h3>
          </header>
          <div className="component-preview">
            <DocumentPreview
              source={snippet}
              projectId={projectId}
              branch={branch}
              path={path ?? "docs/example.mdx"}
              repositoryPaths={repositoryPaths}
            />
          </div>
        </section>
      </div>
      <details className="component-template-options wide-field">
        <summary>Дополнительные настройки</summary>
        <label>
          Имя в MDX
          <input
            name="name"
            defaultValue={component?.name ?? "SupportLink"}
            readOnly={!!component}
            required
            disabled={busy}
          />
        </label>
        <label>
          Описание в каталоге
          <input name="description" defaultValue={component?.description ?? ""} disabled={busy} />
        </label>
      </details>
      <div className="component-template-actions wide-field">
        <button className="pd-button pd-button--primary" type="submit" disabled={busy}>
          {busy ? "Сохраняем…" : "Сохранить шаблон"}
        </button>
        <button
          className="pd-button pd-button--secondary"
          type="button"
          onClick={onCancel}
          disabled={busy}
        >
          Закрыть
        </button>
      </div>
      {saved ? (
        <p role="status" className="wide-field">
          Шаблон сохранён.{" "}
          <Link
            href={`/projects/${projectId}/documents?${new URLSearchParams({ branch, ...(path ? { path } : {}) })}`}
          >
            Открыть редактор
          </Link>
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="wide-field">
          {error}
        </p>
      ) : null}
    </form>
  );
}
