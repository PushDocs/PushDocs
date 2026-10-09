"use client";

import { ExternalLink, GitBranch, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { documentHref, rememberProjectBranch } from "./project-context";

type Preview = {
  branch: string;
  status: string;
  createdAt: string | null;
  readyAt: string | null;
  startupMs: number | null;
  expiresAt: string | null;
  diskBytes: number | null;
  changedFiles: number;
  url: string | null;
  error: string | null;
};
const statuses: Record<string, string> = {
  queued: "В очереди",
  starting: "Создаётся",
  ready: "Работает",
  failed: "Ошибка",
  stopped: "Остановлен",
  deleting: "Удаляется",
};
const date = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

export function PreviewList({ projectId, canDelete }: { projectId: string; canDelete: boolean }) {
  const router = useRouter();
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    let fetching = false;
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        const response = await fetch(`/api/projects/${projectId}/previews`, { cache: "no-store" });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Не удалось получить предпросмотры");
        if (!disposed) {
          setPreviews(result.previews);
          setError("");
        }
      } catch (cause) {
        if (!disposed)
          setError(cause instanceof Error ? cause.message : "Не удалось получить предпросмотры");
      } finally {
        fetching = false;
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [projectId]);

  async function remove(branch: string) {
    if (!window.confirm(`Удалить предпросмотр ветки «${branch}» и его рабочую папку?`)) return;
    setDeleting(branch);
    try {
      const response = await fetch(`/api/projects/${projectId}/previews`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось удалить предпросмотр");
      setPreviews(
        (items) =>
          items?.map((item) => (item.branch === branch ? { ...item, status: "deleting" } : item)) ??
          null,
      );
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Не удалось удалить предпросмотр");
    } finally {
      setDeleting(null);
    }
  }

  return (
    <>
      {error ? (
        <p role="alert" className="danger-icon">
          {error}
        </p>
      ) : null}
      {previews === null ? (
        <p role="status">Загружаем предпросмотры…</p>
      ) : previews.length === 0 ? (
        <p className="panel-note">
          Предпросмотров пока нет. Откройте документы нужной ветки, чтобы создать предпросмотр.
        </p>
      ) : (
        <div className="preview-list">
          {previews.map((item) => (
            <article className="preview-card" key={item.branch}>
              <div className="preview-card-heading">
                <h2>
                  <GitBranch aria-hidden size={18} />
                  {item.branch}
                </h2>
                <span className={`preview-state preview-state--${item.status}`}>
                  {statuses[item.status] ?? item.status}
                </span>
              </div>
              <dl className="preview-metadata">
                <div>
                  <dt>Создан</dt>
                  <dd>{date(item.readyAt ?? item.createdAt)}</dd>
                </div>
                <div>
                  <dt>Время создания</dt>
                  <dd>
                    {item.startupMs === null
                      ? "—"
                      : `${(item.startupMs / 1000).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} с`}
                  </dd>
                </div>
                <div>
                  <dt>Плановое удаление</dt>
                  <dd>
                    {item.expiresAt
                      ? date(item.expiresAt)
                      : item.status === "ready" ||
                          item.status === "queued" ||
                          item.status === "starting"
                        ? "Через сутки после остановки"
                        : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Место на диске</dt>
                  <dd>
                    {item.diskBytes === null
                      ? "Измеряется…"
                      : `${(item.diskBytes / 1024 / 1024).toLocaleString("ru-RU", { maximumFractionDigits: 1 })} МиБ`}
                  </dd>
                </div>
                <div>
                  <dt>Неотправленные изменения</dt>
                  <dd>{item.changedFiles} файлов</dd>
                </div>
                <div>
                  <dt>URL</dt>
                  <dd>
                    {item.url ? (
                      <a href={item.url} target="_blank" rel="noreferrer">
                        {item.url}
                      </a>
                    ) : (
                      "Назначится при запуске"
                    )}
                  </dd>
                </div>
              </dl>
              {item.error ? (
                <p className="preview-error" role="status">
                  {item.error}
                </p>
              ) : null}
              <div className="preview-card-actions">
                <a
                  className="pd-button pd-button--secondary"
                  href={`/projects/${projectId}/previews/view?${new URLSearchParams({ branch: item.branch })}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть предпросмотр
                  <ExternalLink aria-hidden size={15} />
                </a>
                <button
                  type="button"
                  className="pd-button pd-button--secondary"
                  onClick={() => {
                    rememberProjectBranch(projectId, item.branch);
                    router.push(documentHref(projectId, item.branch));
                  }}
                >
                  Переключиться на ветку
                </button>
                {canDelete ? (
                  <button
                    className="pd-button pd-button--secondary"
                    type="button"
                    disabled={item.status === "deleting" || deleting === item.branch}
                    onClick={() => void remove(item.branch)}
                  >
                    <Trash2 aria-hidden size={15} />
                    Удалить
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="panel-note">
        Размер обновляется раз в минуту и не включает общий Git-кеш проекта. Рабочие папки могут
        быть удалены раньше при заполнении диска.
      </p>
    </>
  );
}
