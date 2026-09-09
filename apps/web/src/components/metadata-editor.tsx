"use client";
import { patchMetadata, readMetadata, removeMetadata } from "@pushdocs/content/metadata";
import type { MetadataField } from "@pushdocs/contracts";
import { RotateCcw } from "lucide-react";
import { useEffect, useId, useState } from "react";

const labels: Record<string, string> = {
  title: "Название страницы",
  description: "Описание для поиска",
  sidebar_label: "Название в меню",
  sidebar_position: "Порядок в разделе",
  slug: "Свой адрес",
  draft: "Видимость на сайте",
};

export function MetadataEditor({
  value,
  fields,
  path = "",
  readOnly,
  onChange,
}: {
  value: string;
  fields: MetadataField[];
  path?: string;
  readOnly: boolean;
  onChange: (value: string) => void;
}) {
  const id = useId();
  let metadata: ReturnType<typeof readMetadata>;
  try {
    metadata = readMetadata(value);
  } catch {
    return (
      <p className="wb-alert" role="alert">
        Эти свойства можно изменить только через исходник во вкладке «Файл».
      </p>
    );
  }
  const body = value.replace(/^\uFEFF?---[^\n]*\n[\s\S]*?\n---(?:\r?\n|$)/, "");
  const heading = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
  const defaultTitle =
    heading ??
    path
      .split("/")
      .at(-1)
      ?.replace(/\.mdx?$/, "") ??
    "Из заголовка в тексте";
  const pageTitle = String(metadata.values.title ?? defaultTitle);
  const configured = [...fields];
  if (
    !configured.some((field) => field.name === "sidebar_label") &&
    (configured.some((field) => field.name === "sidebar_position") ||
      metadata.values.sidebar_label !== undefined)
  ) {
    configured.push({ name: "sidebar_label", label: "Название в меню", type: "string" });
  }
  const descriptions: Record<string, string> = {
    title: heading
      ? "Название вкладки браузера. Заголовок внутри статьи меняется в тексте."
      : "Название вкладки браузера и заголовок в начале статьи, если его нет в тексте.",
    description: "Краткое описание для поисковиков и предпросмотра ссылок.",
    sidebar_label: "Как статья называется в меню сайта. Имя файла не меняется.",
    sidebar_position: "Меньшее число — выше в автоматически собранном разделе меню.",
    slug: "Меняет адрес на сайте. Старые ссылки могут перестать работать.",
    draft:
      metadata.values.draft === true
        ? "Статья останется в репозитории, но не попадёт в опубликованный сайт."
        : "Статья будет включена в следующую публикацию сайта.",
  };
  const placeholders: Record<string, string> = {
    title: defaultTitle,
    description: "По умолчанию — начало текста статьи",
    sidebar_label: pageTitle,
    sidebar_position: "Автоматически",
    slug: "Из пути файла",
  };
  const update = (name: string, next: string | number | boolean | undefined) =>
    onChange(
      next === undefined ? removeMetadata(value, name) : patchMetadata(value, { [name]: next }),
    );
  const renderField = (field: MetadataField) => {
    const label = labels[field.name] ?? field.label;
    const blocked = metadata.blocked.includes(field.name);
    const current = metadata.values[field.name];
    const inputId = `${id}-${field.name}`;
    const hint = blocked ? "Измените это значение во вкладке «Файл»." : descriptions[field.name];
    return (
      <div className="metadata-field" key={field.name}>
        <div className="metadata-label">
          <label htmlFor={inputId}>{label}</label>
          {!blocked && current === undefined && Object.hasOwn(labels, field.name) && (
            <small className="metadata-default">По умолчанию</small>
          )}
          {!blocked && current !== undefined && (
            <button
              type="button"
              className="metadata-reset"
              title="Вернуть значение по умолчанию"
              aria-label={`Сбросить: ${label}`}
              disabled={readOnly}
              onClick={() => update(field.name, undefined)}
            >
              <RotateCcw size={13} aria-hidden />
            </button>
          )}
        </div>
        {blocked ? (
          <input id={inputId} disabled value="Задано в исходнике" readOnly />
        ) : field.type === "boolean" ? (
          <select
            id={inputId}
            aria-describedby={hint ? `${inputId}-hint` : undefined}
            disabled={readOnly}
            value={
              field.name === "draft"
                ? String(current ?? false)
                : current === undefined
                  ? ""
                  : String(current)
            }
            onChange={(event) =>
              update(
                field.name,
                event.target.value === "" ? undefined : event.target.value === "true",
              )
            }
          >
            {field.name === "draft" ? (
              <>
                <option value="false">Показывать после публикации</option>
                <option value="true">Исключить из публикации</option>
              </>
            ) : (
              <>
                <option value="">По умолчанию</option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </>
            )}
          </select>
        ) : field.type === "number" ? (
          <NumberField
            id={inputId}
            hint={hint ? `${inputId}-hint` : undefined}
            value={current}
            placeholder={placeholders[field.name]}
            disabled={readOnly}
            onCommit={(next) => update(field.name, next)}
          />
        ) : field.name === "description" ? (
          <textarea
            id={inputId}
            aria-describedby={`${inputId}-hint`}
            disabled={readOnly}
            rows={3}
            maxLength={5000}
            value={String(current ?? "")}
            placeholder={placeholders[field.name]}
            onChange={(event) => update(field.name, event.target.value || undefined)}
          />
        ) : (
          <input
            id={inputId}
            aria-describedby={hint ? `${inputId}-hint` : undefined}
            disabled={readOnly}
            maxLength={5000}
            value={String(current ?? "")}
            placeholder={placeholders[field.name]}
            onChange={(event) => update(field.name, event.target.value || undefined)}
          />
        )}
        {hint && <small id={`${inputId}-hint`}>{hint}</small>}
      </div>
    );
  };
  const group = (names: string[]) =>
    names.flatMap((name) => configured.filter((field) => field.name === name)).map(renderField);
  const other = configured.filter((field) => !Object.hasOwn(labels, field.name));
  return (
    <section className="metadata-editor" aria-label="Настройки статьи">
      <p className="metadata-timing">Применятся на сайте после отправки изменений и публикации.</p>
      <div className="metadata-group">
        <h3>Название и описание</h3>
        {group(["title", "description"])}
      </div>
      {configured.some((field) => field.name.startsWith("sidebar_")) && (
        <div className="metadata-group">
          <h3>В меню сайта</h3>
          {group(["sidebar_label", "sidebar_position"])}
        </div>
      )}
      {configured.some((field) => field.name === "slug") && (
        <details className="metadata-address">
          <summary>
            Адрес статьи{" "}
            <span>
              {metadata.values.slug === undefined ? "Из пути файла" : String(metadata.values.slug)}
            </span>
          </summary>
          <div>
            {group(["slug"])}
            {metadata.values.slug === undefined && path && (
              <small className="metadata-file-path">
                Путь файла: <code>{path}</code>
              </small>
            )}
          </div>
        </details>
      )}
      {group(["draft"])}
      {other.length > 0 && (
        <details className="metadata-address">
          <summary>Другие свойства</summary>
          <div>{other.map(renderField)}</div>
        </details>
      )}
    </section>
  );
}

function NumberField({
  id,
  hint,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  id: string;
  hint?: string;
  value: string | number | boolean | undefined;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: number | undefined) => void;
}) {
  const [input, setInput] = useState(String(value ?? ""));
  useEffect(() => setInput(String(value ?? "")), [value]);
  return (
    <input
      id={id}
      aria-describedby={hint}
      type="number"
      step="any"
      value={input}
      placeholder={placeholder}
      disabled={disabled}
      onChange={(event) => setInput(event.target.value)}
      onBlur={() => {
        if (!input) onCommit(undefined);
        else if (Number.isFinite(Number(input))) onCommit(Number(input));
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}
