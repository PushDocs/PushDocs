"use client";

import { Button } from "@pushdocs/ui";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

interface Asset {
  path: string;
  url: string | null;
  status: string;
  size: number | null;
  usages: string[];
}
interface MediaState {
  assets: Asset[];
  revision: number;
  status: string;
  role: string;
  locale: string;
}

export function MediaLibrary({
  projectId,
  branch,
  document,
  onInsert,
}: {
  projectId: string;
  branch: string;
  document: string;
  onInsert?: (url: string) => void;
}) {
  const [state, setState] = useState<MediaState>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<Asset>();
  const [busy, setBusy] = useState(false);
  const [locale, setLocale] = useState("");
  const [replace, setReplace] = useState(false);
  const [destination, setDestination] = useState("");
  const [progress, setProgress] = useState<{ name: string; percent: number }>();
  const [retry, setRetry] = useState(false);
  const pending = useRef<File[]>([]);
  const transfer = useRef<XMLHttpRequest | undefined>(undefined);
  const uploading = useRef(false);
  const endpoint = `/api/projects/${projectId}/media`;
  const reload = useCallback(async () => {
    const params = new URLSearchParams({ branch, document, ...(locale ? { locale } : {}) });
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error);
    setState(next);
    return next as MediaState;
  }, [branch, document, endpoint, locale]);
  useEffect(() => {
    const refresh = () => {
      void reload().catch((cause) => setError(String(cause)));
    };
    refresh();
    window.addEventListener("pushdocs:refresh", refresh);
    return () => window.removeEventListener("pushdocs:refresh", refresh);
  }, [reload]);
  const readOnly = !state || state.role === "reader" || state.status !== "open";
  useEffect(() => () => transfer.current?.abort(), []);
  async function upload(files: File[]) {
    if (readOnly || busy || uploading.current) return;
    uploading.current = true;
    pending.current = files;
    setBusy(true);
    setRetry(false);
    setError("");
    try {
      while (pending.current.length) {
        const file = pending.current[0];
        if (!file) break;
        if (file.size > 64 * 1024 * 1024) throw new Error(`${file.name}: лимит 64 МиБ`);
        const current = await reload();
        const params = new URLSearchParams({
          branch,
          name: file.name,
          document,
          locale: current.locale,
          revision: String(current.revision),
          replace: String(replace),
          ...(destination ? { path: `${destination.replace(/\/$/, "")}/${file.name}` } : {}),
        });
        setProgress({ name: file.name, percent: 0 });
        await new Promise<void>((resolve, reject) => {
          const xhr = new XMLHttpRequest();
          transfer.current = xhr;
          xhr.upload.addEventListener("progress", (event) => {
            if (event.lengthComputable && event.total > 0)
              setProgress({
                name: file.name,
                percent: Math.round((event.loaded / event.total) * 100),
              });
          });
          xhr.addEventListener("load", () => {
            try {
              const result = JSON.parse(xhr.responseText);
              if (xhr.status < 200 || xhr.status >= 300)
                throw new Error(result.error ?? "Ошибка загрузки");
              resolve();
            } catch (cause) {
              reject(cause);
            }
          });
          xhr.addEventListener("error", () =>
            reject(new Error("Соединение потеряно. Проверьте список файлов перед повтором.")),
          );
          xhr.addEventListener("timeout", () =>
            reject(new Error("Время загрузки истекло. Проверьте список файлов перед повтором.")),
          );
          xhr.addEventListener("abort", () =>
            reject(
              new Error("Загрузка отменена. Сервер мог уже сохранить файл, проверьте список."),
            ),
          );
          xhr.open("POST", `/api/projects/${projectId}/assets?${params}`);
          xhr.timeout = 600_000;
          xhr.send(file);
        });
        transfer.current = undefined;
        pending.current.shift();
      }
      await reload();
    } catch (cause) {
      setError(String(cause));
      setRetry(pending.current.length > 0);
      await reload().catch(() => undefined);
    } finally {
      transfer.current = undefined;
      uploading.current = false;
      setProgress(undefined);
      setBusy(false);
    }
  }
  async function mutate(asset: Asset, action: "delete" | "revert") {
    if (!state || readOnly || busy) return;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          branch,
          path: asset.path,
          revision: state.revision,
          document,
          locale: state.locale,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setSelected(undefined);
      await reload();
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="media-library" aria-label="Медиатека">
      <section
        className="media-upload"
        aria-label="Загрузка файлов"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <p>Перетащите файлы сюда или выберите их. До 64 МиБ на файл, загрузка по очереди.</p>
        <label>
          Загрузить файлы
          <input
            type="file"
            multiple
            disabled={readOnly || busy}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void upload(files);
            }}
          />
        </label>
        <label>
          Каталог назначения
          <input
            value={destination}
            placeholder="По настройкам проекта"
            disabled={busy || readOnly}
            onChange={(event) => setDestination(event.target.value)}
          />
        </label>
        <label className="media-checkbox">
          <input
            type="checkbox"
            checked={replace}
            disabled={busy || readOnly}
            onChange={(event) => setReplace(event.target.checked)}
          />
          Заменять существующие файлы с такими же путями
        </label>
        {progress ? (
          <div role="status">
            <p>
              {progress.name}: {progress.percent}%
              {progress.percent === 100 ? " — ожидаем сохранения" : ""}
            </p>
            <progress aria-label="Прогресс загрузки" max={100} value={progress.percent} />
            <Button type="button" onClick={() => transfer.current?.abort()}>
              Отменить загрузку
            </Button>
          </div>
        ) : null}
        {retry ? (
          <Button
            type="button"
            disabled={busy || readOnly}
            onClick={() => {
              void upload(pending.current);
            }}
          >
            Повторить оставшиеся загрузки
          </Button>
        ) : null}
      </section>
      <div className="media-toolbar">
        <label>
          Найти файл
          <input value={query} onChange={(event) => setQuery(event.target.value)} type="search" />
        </label>
        <label>
          Язык каталога
          <input
            value={locale || state?.locale || ""}
            onChange={(event) => setLocale(event.target.value)}
            disabled={busy}
          />
        </label>
        <Button
          type="button"
          disabled={busy}
          onClick={() => {
            void reload()
              .then(() => setError(""))
              .catch((cause) => setError(String(cause)));
          }}
        >
          Обновить
        </Button>
      </div>
      {error ? <p role="alert">{error}</p> : null}
      {!state ? <p role="status">Загружаем медиатеку…</p> : null}
      {selected ? (
        <section className="media-confirm" aria-label="Удаление файла">
          <h2>Удалить {selected.path}?</h2>
          <p>Удаление попадёт в общий набор изменений. В Git файл останется до отправки коммита.</p>
          <p>
            Возможные использования по имени файла. Динамические ссылки могут не попасть в список.
          </p>
          <ul>
            {selected.usages.map((filePath) => (
              <li key={filePath}>
                <Link
                  href={`/projects/${projectId}/documents?${new URLSearchParams({ branch, path: filePath })}`}
                >
                  {filePath}
                </Link>
              </li>
            ))}
          </ul>
          <Button
            type="button"
            tone="danger"
            disabled={busy || readOnly}
            onClick={() => {
              void mutate(selected, "delete");
            }}
          >
            Подтвердить удаление
          </Button>
          <Button type="button" disabled={busy} onClick={() => setSelected(undefined)}>
            Отмена
          </Button>
        </section>
      ) : null}
      <div className="asset-grid">
        {state?.assets
          .filter((asset) => asset.path.toLowerCase().includes(query.toLowerCase()))
          .map((asset) => (
            <article className="media-card" key={asset.path}>
              {asset.status !== "delete" && /\.(png|jpe?g|gif|webp|avif)$/i.test(asset.path) ? (
                // biome-ignore lint/performance/noImgElement: private media require the authenticated asset route
                <img
                  alt={asset.path}
                  loading="lazy"
                  src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path })}`}
                />
              ) : (
                <span className="media-placeholder">
                  {asset.status === "delete" ? "Удаление" : "Файл"}
                </span>
              )}
              <strong>{asset.path}</strong>
              <small>
                {asset.status === "upload"
                  ? "Загружен в черновик"
                  : asset.status === "delete"
                    ? "Будет удалён"
                    : "Из Git"}
                {asset.size === null ? "" : ` · ${(asset.size / 1024).toFixed(1)} КиБ`}
              </small>
              <div className="media-actions">
                <a
                  href={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path })}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть
                </a>
                {asset.url && onInsert && asset.status !== "delete" ? (
                  <Button
                    type="button"
                    disabled={busy || readOnly}
                    onClick={() => onInsert(asset.url!)}
                  >
                    Вставить ссылку
                  </Button>
                ) : null}
                {asset.url ? (
                  <Button
                    type="button"
                    disabled={readOnly || busy}
                    aria-label={`${asset.status === "delete" ? "Отменить удаление" : "Удалить"} ${asset.path}`}
                    onClick={() => {
                      if (asset.status === "delete") void mutate(asset, "revert");
                      else setSelected(asset);
                    }}
                  >
                    {asset.status === "delete" ? "Отменить удаление" : "Удалить"}
                  </Button>
                ) : (
                  <small>Путь вне настроенного каталога</small>
                )}
              </div>
            </article>
          ))}
      </div>
      {state?.assets.length === 0 ? <p>В этой ветке пока нет медиафайлов.</p> : null}
    </section>
  );
}
