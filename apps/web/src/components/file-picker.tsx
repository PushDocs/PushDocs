"use client";
import { type InputHTMLAttributes, useState } from "react";

export function FilePicker(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "value" | "defaultValue">,
) {
  const [names, setNames] = useState("");
  return (
    <span className="file-picker" data-disabled={props.disabled || undefined}>
      <input
        {...props}
        type="file"
        className="file-picker-input"
        onChange={(event) => {
          setNames(Array.from(event.currentTarget.files ?? [], (file) => file.name).join(", "));
          props.onChange?.(event);
          if (!event.currentTarget.value) setNames("");
        }}
      />
      <span className="pd-button pd-button--secondary" aria-hidden="true">
        Выбрать {props.multiple ? "файлы" : "файл"}
      </span>
      <span className="file-picker-name" aria-live="polite">
        {names || "Файл не выбран"}
      </span>
    </span>
  );
}
