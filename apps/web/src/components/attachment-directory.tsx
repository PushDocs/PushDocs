"use client";

import { useId } from "react";

export function AttachmentDirectory({
  value,
  onChange,
  disabled = false,
  sharedDirectories = ["static"],
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  sharedDirectories?: string[];
}) {
  const noteId = useId();
  const directory = value.trim().replace(/\/+$/, "");
  const shared = [...sharedDirectories]
    .sort((a, b) => a.length - b.length)
    .find((root) => directory === root || directory.startsWith(`${root}/`));
  return (
    <div className="attachment-directory">
      <label>
        Папка загрузки
        <input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Например, static/img"
          disabled={disabled}
          aria-describedby={shared || !directory ? noteId : undefined}
        />
      </label>
      {shared ? (
        <p id={noteId} role="note">
          Вложения из папки {shared} дублируются в сборке для каждой локали.
        </p>
      ) : !directory ? (
        <p id={noteId}>Укажите папку перед загрузкой нового файла.</p>
      ) : null}
    </div>
  );
}
