"use client";

import { safePath } from "@pushdocs/content/config";
import {
  groupMediaAssets,
  isDocMediaFile,
  isVideoFile,
  mediaDisplayPath,
} from "@pushdocs/content/media";
import { Button } from "@pushdocs/ui";
import { Download, FileText, Link2, Trash2, Undo2, Upload } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AttachmentDirectory } from "./attachment-directory";
import { MediaGallery } from "./media-gallery";
import { MediaPreview } from "./media-preview";
import { AssetUsages, useUploadConflict } from "./upload-conflict";

interface Asset {
  path: string;
  url: string | null;
  canDelete: boolean;
  inRepository: boolean;
  status: string;
  size: number | null;
  usages: string[];
  shadowedBy?: string;
}
interface MediaState {
  assets: Asset[];
  directories?: string[];
  sharedDirectories?: string[];
  uploadDirectory?: string;
  revision: number;
  status: string;
  role: string;
  locale: string;
}

const isNewAsset = (asset: Asset) => asset.status === "upload" && !asset.inRepository;

export function MediaLibrary({
  projectId,
  branch,
  document,
  onInsert,
  onChanged,
  onBusyChange,
  initialQuery = "",
  replacePath,
  insertionMode,
  onUploadComplete,
}: {
  projectId: string;
  branch: string;
  document: string;
  onInsert?: (url: string, path: string) => void;
  onChanged?: (path?: string) => Promise<void>;
  onBusyChange?: (busy: boolean) => void;
  initialQuery?: string;
  replacePath?: string;
  insertionMode?: "markdown" | "docmedia" | "video";
  onUploadComplete?: (assets: Array<{ path: string; url: string }>) => void;
}) {
  const conflict = useUploadConflict();
  const [localReplacePath, setLocalReplacePath] = useState<string>();
  const replacementPath = replacePath ?? localReplacePath;
  const [state, setState] = useState<MediaState>();
  const [localUploadDirectory, setLocalUploadDirectory] = useState<string>();
  const docMedia = insertionMode === "docmedia";
  const video = insertionMode === "video";
  const componentMedia = docMedia || video;
  const supportsFile = video ? isVideoFile : docMedia ? isDocMediaFile : () => true;
  const insertMode = insertionMode !== undefined;
  const directory = localUploadDirectory ?? state?.uploadDirectory ?? "";
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const uploadRegion = useRef<HTMLElement>(null);
  const scrollRegion = useRef<HTMLElement>(null);
  const [query, setQuery] = useState(initialQuery);
  const [selected, setSelected] = useState<Asset>();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<{ name: string; percent: number }>();
  const [retry, setRetry] = useState(false);
  const pending = useRef<File[]>([]);
  const transfer = useRef<XMLHttpRequest | undefined>(undefined);
  const uploading = useRef(false);
  const endpoint = `/api/projects/${projectId}/media`;
  const reload = useCallback(async () => {
    const params = new URLSearchParams({ branch, document });
    if (insertionMode === "docmedia" || insertionMode === "video")
      params.set("mode", insertionMode);
    else if (insertMode) params.set("mode", "article");
    const response = await fetch(`${endpoint}?${params}`, { cache: "no-store" });
    const next = await response.json();
    if (!response.ok) throw new Error(next.error);
    setState(next);
    setLocalUploadDirectory((current) => current ?? next.uploadDirectory);
    return next as MediaState;
  }, [branch, document, endpoint, insertionMode, insertMode]);
  useEffect(() => {
    if (insertMode && !replacementPath) setQuery(directory.trim().replace(/\/+$/, ""));
  }, [insertMode, replacementPath, directory]);
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
    /* v8 ignore next -- upload controls are disabled for all three guarded states. */
    if (readOnly || busy || uploading.current) return;
    if (replacementPath && files.length > 1) {
      setError("Для замены выберите один файл.");
      return;
    }
    if (insertMode && files.length > 1) {
      setError("Для вставки выберите один файл.");
      return;
    }
    if (files.some((file) => !supportsFile(file.name))) {
      setError(video ? "Video поддерживает MP4." : "DocMedia поддерживает изображения и MP4.");
      return;
    }
    const targetDirectory = directory.trim().replace(/\/+$/, "");
    if (!replacementPath && !targetDirectory) {
      setError("Укажите папку для загрузки вложений.");
      return;
    }
    uploading.current = true;
    pending.current = files;
    setBusy(true);
    setRetry(false);
    setError("");
    setSuccess("");
    const uploadedPaths: string[] = [];
    let uploadedCount = 0;
    try {
      while (pending.current.length) {
        const file = pending.current[0];
        /* v8 ignore next -- a positive array length guarantees this indexed item. */
        if (!file) break;
        if (file.size > 64 * 1024 * 1024) throw new Error(`${file.name}: лимит 64 МиБ`);
        const current = await reload();
        let targetPath = replacementPath;
        let replace = !!replacementPath;
        if (!targetPath) {
          targetPath = safePath(`${safePath(targetDirectory)}/${file.name}`);
          while (current.assets.some((asset) => asset.path === targetPath)) {
            const decision = await conflict.ask(targetPath);
            if (decision.action === "skip") {
              targetPath = undefined;
              break;
            }
            if (decision.action === "replace") {
              replace = true;
              break;
            }
            if (!decision.name || /[/\\]/.test(decision.name))
              throw new Error("Введите имя файла без папок");
            targetPath = safePath(`${targetDirectory}/${decision.name}`);
          }
          if (!targetPath) {
            pending.current.shift();
            continue;
          }
        }
        const params = new URLSearchParams({
          branch,
          name: file.name,
          document,
          locale: current.locale,
          revision: String(current.revision),
          replace: String(replace),
          ...(targetPath ? { path: targetPath } : {}),
          destination: "repository",
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
        if (uploadedPath) uploadedPaths.push(uploadedPath);
        uploadedCount++;
        setSuccess(`Загружено файлов: ${uploadedCount}`);
        await onChanged?.(uploadedPath);
      }
      const refreshed = await reload();
      setLocalReplacePath(undefined);
      if (insertMode && uploadedPaths.length) {
        const uploadedAssets = uploadedPaths.flatMap((path) => {
          const asset = refreshed.assets.find((item) => item.path === path);
          return asset?.url ? [{ path, url: asset.url }] : [];
        });
        if (uploadedAssets.length !== uploadedPaths.length) {
          setError("Файл загружен, но его нельзя вставить по текущим настройкам вложений.");
        } else {
          onUploadComplete?.(uploadedAssets);
        }
      }
    } catch (cause) {
      setError(
        `Не удалось загрузить ${pending.current[0]?.name ?? "файл"}: ${cause instanceof Error ? cause.message : "Ошибка загрузки"}`,
      );
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
    /* v8 ignore next -- mutation controls are absent or disabled in these states. */
    if (!state || readOnly || busy) return;
    setBusy(true);
    setSuccess("");
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
      if (action === "delete")
        setSuccess(asset.inRepository ? "Файл отмечен для удаления" : "Файл удалён");
    } catch (cause) {
      setError(String(cause));
    } finally {
      setBusy(false);
    }
  }
  const showLibrary = !replacementPath;
  const scopedDirectory = directory.trim().replace(/\/+$/, "");
  const assets = state?.assets.filter(
    (asset) =>
      supportsFile(asset.path) &&
      (insertMode && scopedDirectory && query === scopedDirectory
        ? asset.path.startsWith(`${scopedDirectory}/`)
        : asset.path.toLowerCase().includes(query.toLowerCase())),
  );
  const newAssets = assets?.filter(isNewAsset) ?? [];
  const groups = groupMediaAssets(
    assets?.filter((asset) => !isNewAsset(asset)) ?? [],
    state?.directories,
  );
  if (newAssets.length) groups.unshift({ id: "new", label: "Новые файлы", assets: newAssets });
  return (
    <section
      className={`media-library${replacementPath ? " media-library-replacement" : ""}`}
      aria-label="Медиатека"
      ref={scrollRegion}
    >
      {conflict.panel}
      {state && readOnly ? (
        <p role="status">
          {state.role === "reader"
            ? "У вас роль читателя. Для замены и удаления нужна роль редактора."
            : "Замена и удаление станут доступны после завершения отправки или разрешения конфликтов."}
        </p>
      ) : null}
      {replacementPath ? (
        <div>
          <p>
            Заменить файл: <strong>{replacementPath}</strong>
          </p>
          <p>Имя и путь сохранятся. Файл обновится во всех документах, где он используется.</p>
          {state ? (
            <AssetUsages
              paths={state.assets.find((asset) => asset.path === replacementPath)?.usages ?? []}
            />
          ) : null}
          {localReplacePath ? (
            <Button type="button" disabled={busy} onClick={() => setLocalReplacePath(undefined)}>
              Отменить замену
            </Button>
          ) : null}
        </div>
      ) : null}
      {!replacementPath ? (
        <AttachmentDirectory
          value={directory}
          sharedDirectories={state?.sharedDirectories}
          disabled={readOnly || busy}
          onChange={setLocalUploadDirectory}
        />
      ) : null}
      <section
        ref={uploadRegion}
        className="media-upload"
        aria-label="Загрузка файлов"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          event.preventDefault();
          void upload(Array.from(event.dataTransfer.files));
        }}
      >
        <label
          className="media-upload-picker"
          aria-disabled={readOnly || busy || (!replacementPath && !directory.trim())}
        >
          <span>
            <Upload size={16} /> Загрузить файлы
          </span>
          <small>или перетащите сюда · до 64 МиБ</small>
          <input
            type="file"
            accept={
              video ? ".mp4" : docMedia ? ".png,.jpg,.jpeg,.gif,.webp,.avif,.svg,.mp4" : undefined
            }
            aria-label="Загрузить файлы"
            multiple={!replacementPath && !insertMode}
            disabled={readOnly || busy || (!replacementPath && !directory.trim())}
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              void upload(files);
            }}
          />
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
      {showLibrary ? (
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
      ) : null}
      {success ? <p role="status">{success}</p> : null}
      {error ? <p role="alert">{error}</p> : null}
      {!state && !error ? <p role="status">Загружаем медиатеку…</p> : null}
      {showLibrary && selected ? (
        <section className="media-confirm" aria-label="Удаление файла">
          <h2>Удалить {selected.path}?</h2>
          <p>
            {selected.inRepository
              ? "Удаление попадёт в общий набор изменений. В Git файл останется до отправки коммита."
              : "Файл будет удалён."}
          </p>
          <p>
            {selected.usages.length
              ? `Возможные ссылки в документах: ${selected.usages.length}`
              : "Ссылки в документах не найдены."}
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
      {showLibrary ? (
        <MediaGallery
          key={`${projectId}:${branch}:${state?.revision}`}
          groups={groups}
          scrollRef={scrollRegion}
          resetKey={query}
          renderAsset={(asset, directory) => (
            <article className="media-card" key={asset.path}>
              {asset.status !== "delete" &&
              /\.(png|jpe?g|gif|webp|avif|svg|mp4)$/i.test(asset.path) ? (
                <MediaPreview
                  key={`${projectId}:${branch}:${asset.path}:${state?.revision}`}
                  path={asset.path}
                  src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path, revision: String(state?.revision) })}`}
                />
              ) : (
                <span className="media-placeholder">
                  {asset.status === "delete" ? "Удаление" : <FileText size={30} />}
                </span>
              )}
              <strong title={asset.path}>{asset.path.split("/").at(-1)}</strong>
              <small className="media-card-path">{mediaDisplayPath(asset.path, directory)}</small>
              {asset.shadowedBy ? (
                <small className="media-card-path">
                  Вставка недоступна: этот URL используется файлом {asset.shadowedBy}.
                </small>
              ) : null}
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
                {asset.url && onInsert && supportsFile(asset.path) && asset.status !== "delete" ? (
                  <Button
                    type="button"
                    disabled={busy || readOnly}
                    aria-label={`Вставить ${asset.path}`}
                    title="Вставить"
                    onClick={() => {
                      if (asset.url) onInsert(asset.url, asset.path);
                    }}
                  >
                    <Link2 aria-hidden size={16} /> Вставить
                  </Button>
                ) : null}
                {!componentMedia && asset.status !== "delete" ? (
                  <Button
                    type="button"
                    disabled={readOnly || busy}
                    aria-label={`Заменить ${asset.path}`}
                    onClick={() => {
                      setSelected(undefined);
                      setLocalReplacePath(asset.path);
                      uploadRegion.current?.scrollIntoView?.({
                        block: "start",
                        behavior: "smooth",
                      });
                    }}
                  >
                    <Upload aria-hidden size={16} /> Заменить
                  </Button>
                ) : null}
                <a
                  href={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: asset.path, revision: String(state?.revision), download: "true" })}`}
                  download={asset.path.split("/").at(-1)}
                  className="media-icon-action"
                  aria-label={`Скачать ${asset.path}`}
                  title="Скачать"
                >
                  <Download aria-hidden size={16} />
                </a>
                <Button
                  type="button"
                  disabled={readOnly || busy || !asset.canDelete}
                  className="media-icon-action"
                  tone={asset.status === "delete" ? "secondary" : "danger"}
                  title={
                    !asset.canDelete
                      ? "Удаление запрещено настройками проекта"
                      : asset.status === "delete"
                        ? "Отменить удаление"
                        : "Удалить"
                  }
                  aria-label={`${asset.status === "delete" ? "Отменить удаление" : "Удалить"} ${asset.path}`}
                  onClick={() => {
                    if (asset.status === "delete") void mutate(asset, "revert");
                    else setSelected(asset);
                  }}
                >
                  {asset.status === "delete" ? (
                    <Undo2 aria-hidden size={16} />
                  ) : (
                    <Trash2 aria-hidden size={16} />
                  )}
                </Button>
              </div>
              {!asset.canDelete ? <small>Удаление запрещено настройками проекта</small> : null}
            </article>
          )}
        />
      ) : null}
      {showLibrary && state && state.assets.length > 0 && assets?.length === 0 ? (
        <p>Файлы не найдены.</p>
      ) : null}
      {showLibrary && state?.assets.length === 0 ? <p>В этой ветке пока нет медиафайлов.</p> : null}
    </section>
  );
}
