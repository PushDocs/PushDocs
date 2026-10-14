"use client";

import { Button } from "@pushdocs/ui";
import { useEffect, useRef, useState } from "react";
import type { UploadDecision } from "./explorer-upload";

export function AssetUsages({ paths }: { paths: string[] }) {
  return (
    <div className="wb-asset-usages">
      <p>
        {paths.length
          ? `Возможные ссылки в документах: ${paths.length}.`
          : "Ссылки в документах не найдены."}
      </p>
      {paths.length ? (
        <ul>
          {paths.map((path) => (
            <li key={path}>{path}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function useUploadConflict() {
  const [path, setPath] = useState<string>();
  const resolve = useRef<((decision: UploadDecision) => void) | undefined>(undefined);
  useEffect(() => () => resolve.current?.({ action: "skip" }), []);
  function decide(decision: UploadDecision) {
    resolve.current?.(decision);
    resolve.current = undefined;
    setPath(undefined);
  }
  return {
    ask: (nextPath: string) =>
      new Promise<UploadDecision>((done) => {
        resolve.current = done;
        setPath(nextPath);
      }),
    panel: path ? <UploadConflict key={path} path={path} onDecision={decide} /> : null,
  };
}

function UploadConflict({
  path,
  onDecision,
}: {
  path: string;
  onDecision: (decision: UploadDecision) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const container = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => previous?.focus();
  }, []);
  return (
    <div className="wb-modal-backdrop wb-upload-conflict">
      <section
        ref={container}
        className="wb-modal"
        role="alertdialog"
        aria-modal="true"
        aria-label="Файл уже существует"
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") {
            event.stopPropagation();
            onDecision({ action: "skip" });
          }
          if (event.key === "Tab") {
            const controls = [
              ...(container.current?.querySelectorAll<HTMLElement>("input,button") ?? []),
            ];
            const next =
              controls[
                (controls.indexOf(document.activeElement as HTMLElement) +
                  (event.shiftKey ? controls.length - 1 : 1)) %
                  controls.length
              ];
            event.preventDefault();
            next?.focus();
          }
        }}
      >
        <header>
          <h2>Файл уже существует</h2>
        </header>
        <p>
          Файл <strong>{path}</strong> уже существует. Что сделать с загружаемым файлом?
        </p>
        <p>
          При замене имя и путь сохранятся. Файл обновится во всех документах, где он используется.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            const name = input.current?.value.trim() ?? "";
            if (name === path.split("/").at(-1)) {
              input.current?.setCustomValidity("Укажите другое имя файла");
              input.current?.reportValidity();
            } else if (name) onDecision({ action: "rename", name });
          }}
        >
          <label>
            Новое имя файла
            <input
              ref={input}
              onInput={() => input.current?.setCustomValidity("")}
              name="filename"
              defaultValue={path.split("/").at(-1)}
              required
              pattern="[^/\\\\]+"
            />
          </label>
          <div className="wb-actions">
            <Button tone="primary" type="button" onClick={() => onDecision({ action: "replace" })}>
              Заменить
            </Button>
            <Button type="submit">Сохранить под другим именем</Button>
            <Button type="button" onClick={() => onDecision({ action: "skip" })}>
              Пропустить
            </Button>
          </div>
        </form>
      </section>
    </div>
  );
}
