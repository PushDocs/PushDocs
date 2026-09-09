"use client";

import { Button } from "@pushdocs/ui";
import { FileText, GitBranch, Upload } from "lucide-react";
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
  onChanged,
  onBusyChange,
}: {
  projectId: string;
  branch: string;
  document: string;
  onInsert?: (url: string) => void;
  onChanged?: (path?: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [state, setState] = useState<MediaState>();
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [onlyArticle, setOnlyArticle] = useState(false);
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
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
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
        const uploadedPath = await new Promise<string | undefined>((resolve, reject) => {
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
              resolve(typeof result.path === "string" ? result.path : undefined);
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
        await onChanged?.(uploadedPath);
      }
      await reload();
    } catch (cause) {
      setError(String(cause));
      setRetry(pending.current.length > 0);
      await reload().catch(() => undefined);
      await onChanged?.().catch(() => undefined);
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
      await onChanged?.();
      setError("");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const assets = state?.assets.filter(
    (asset) =>
      asset.path.toLowerCase().includes(query.toLowerCase()) &&
      (!onlyArticle || asset.usages.includes(document)),
  );
  return (
    <section className="media-library" aria-label="Медиатека">
      <div className="media-context">
        <span title={branch}>
          <GitBranch size={14} />
          {branch}
        </span>
        {document ? <span title={document}>{document}</span> : null}
      </div>
      <p className="media-change-link">
        Загруженные файлы отправляются вместе со статьями через{" "}
        <Link href={`/projects/${projectId}/changes?${new URLSearchParams({ branch })}`}>
          «Изменения»
        </Link>
        .
      </p>
      <section
        className="media-upload"
        aria-label="Загрузка файлов"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <label className="media-upload-picker">
          <span>
            <Upload size={16} /> Загрузить файлы
          </span>
          <small>или перетащите сюда · до 64 МиБ</small>
          <input
            aria-label="Загрузить файлы"
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
        <details className="media-options">
          <summary>Настройки загрузки</summary>
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
          <label>
            Язык каталога
            <input
              value={locale || state?.locale || ""}
              onChange={(event) => setLocale(event.target.value)}
              disabled={busy}
            />
          </label>
        </details>
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
      {document ? (
        <label className="media-article-filter">
          <input
            type="checkbox"
            checked={onlyArticle}
            onChange={(event) => setOnlyArticle(event.target.checked)}
          />{" "}
          Только в этой статье
        </label>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {!state ? <p role="status">Загружаем медиатеку…</p> : null}
      {selected ? (
        <section className="media-confirm" aria-label="Удаление файла">
          <h2>Удалить {selected.path}?</h2>
          <p>Удаление попадёт в общий набор изменений. В Git файл останется до отправки коммита.</p>
          {selected.usages.length ? <p>Ссылки на этот файл могут быть в статьях:</p> : null}
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
        {assets?.map((asset) => (
          <article className="media-card" key={asset.path}>
            {asset.status !== "delete" && /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(asset.path) ? (
              // biome-ignore lint/performance/noImgElement: private media require the authenticated asset route
              <img
                alt={asset.path}
                loading="lazy"
                src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path, revision: String(state?.revision) })}`}
              />
            ) : (
              <span className="media-placeholder">
                {asset.status === "delete" ? "Удаление" : <FileText size={30} />}
              </span>
            )}
            <strong>{asset.path}</strong>
            {asset.status !== "clean" || asset.size !== null ? (
              <small>
                {asset.status === "upload"
                  ? "Загружен в черновик"
                  : asset.status === "delete"
                    ? "Будет удалён"
                    : ""}
                {asset.size === null
                  ? ""
                  : `${asset.status === "clean" ? "" : " · "}${(asset.size / 1024).toFixed(1)} КиБ`}
              </small>
            ) : null}
            <div className="media-actions">
              <a
                href={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path, revision: String(state?.revision) })}`}
                target="_blank"
                rel="noreferrer"
              >
                Открыть
              </a>
              {asset.url && onInsert && asset.status !== "delete" ? (
                <Button
                  type="button"
                  disabled={busy || readOnly}
                  onClick={() => {
                    if (asset.url) onInsert(asset.url);
                  }}
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
                <span
                  className="media-scope"
                  title="Вставка и удаление доступны в каталоге вложений, указанном в настройках проекта."
                >
                  Вне каталога вложений
                </span>
              )}
            </div>
          </article>
        ))}
      </div>
      {state && state.assets.length > 0 && assets?.length === 0 ? <p>Файлы не найдены.</p> : null}
      {state?.assets.length === 0 ? <p>В этой ветке пока нет медиафайлов.</p> : null}
    </section>
  );
}
