"use client";
import { patchMetadata, readMetadata } from "@pushdocs/content/metadata";
import type { MetadataField } from "@pushdocs/contracts";
import { useId } from "react";

export function MetadataEditor({
  value,
  fields,
  readOnly,
  onChange,
}: {
  value: string;
  fields: MetadataField[];
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
        Форма не поддерживает этот front matter. Используйте исходник: его содержимое не изменено.
      </p>
    );
  }
  return (
    <section className="metadata-editor" aria-label="Метаданные документа">
      <p className="wb-hint">
        Поля сохраняются в черновик вместе с документом. Неизвестные поля и сложные значения
        остаются в исходнике.
      </p>
      {fields.map((field) => {
        const blocked = metadata.blocked.includes(field.name);
        const current = metadata.values[field.name];
        const change = (input: string) => {
          if (field.type !== "string" && input === "") return;
          const next =
            field.type === "number"
              ? Number(input)
              : field.type === "boolean"
                ? input === "true"
                : input;
          if (typeof next === "number" && !Number.isFinite(next)) return;
          onChange(patchMetadata(value, { [field.name]: next }));
        };
        return (
          <label key={field.name} htmlFor={`${id}-${field.name}`}>
            <span>{field.label}</span>
            {blocked ? (
              <>
                <input
                  id={`${id}-${field.name}`}
                  aria-label={field.label}
                  disabled
                  value="Сложное значение"
                  readOnly
                />
                <small>Сложное значение. Изменяйте в исходнике.</small>
              </>
            ) : field.type === "boolean" ? (
              <select
                id={`${id}-${field.name}`}
                aria-label={field.label}
                disabled={readOnly}
                value={current === undefined ? "" : String(current)}
                onChange={(event) => change(event.target.value)}
              >
                <option value="" disabled>
                  Не задано
                </option>
                <option value="true">Да</option>
                <option value="false">Нет</option>
              </select>
            ) : (
              <input
                id={`${id}-${field.name}`}
                aria-label={field.label}
                disabled={readOnly}
                type={field.type === "number" ? "number" : "text"}
                step="any"
                maxLength={5000}
                value={current === undefined ? "" : String(current)}
                onChange={(event) => change(event.target.value)}
              />
            )}
          </label>
        );
      })}
    </section>
  );
}
