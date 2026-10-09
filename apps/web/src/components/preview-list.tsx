"use client";

import { ChevronDown, ExternalLink, Pause, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { documentHref, rememberProjectBranch } from "./project-context";
import { SettingsModal, SettingsModalCancel, useSettingsModal } from "./settings-modal";

type Preview = {
  branch: string;
  isDefault: boolean;
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
  starting: "В процессе создания",
  updating: "Обновляется",
  ready: "Запущен",
  deployed: "Развернут",
  failed: "Ошибка",
  stopped: "Развернут",
  stopping: "Останавливается",
  deleting: "В процессе удаления",
};
const date = (value: string | null) => (value ? new Date(value).toLocaleString("ru-RU") : "—");

function DeleteConfirmation({
  branch,
  pending,
  error,
  onConfirm,
}: {
  branch: string;
  pending: boolean;
  error: string;
  onConfirm: () => void;
}) {
  const modal = useSettingsModal();
  useEffect(() => {
    modal.setPending(pending);
  }, [modal.setPending, pending]);
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm();
      }}
    >
      <p>Удалить предпросмотр ветки «{branch}» и его рабочую папку?</p>
      {error ? (
        <p role="alert" className="danger-icon">
          {error}
        </p>
      ) : null}
      <div className="settings-modal-actions">
        <SettingsModalCancel />
        <button className="pd-button pd-button--danger" type="submit" disabled={pending}>
          {pending ? "Удаляем…" : "Удалить предпросмотр"}
        </button>
      </div>
    </form>
  );
}

export function PreviewList({ projectId, canDelete }: { projectId: string; canDelete: boolean }) {
  const router = useRouter();
  const [previews, setPreviews] = useState<Preview[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [actionError, setActionError] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
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
          setLoadError("");
        }
      } catch (cause) {
        if (!disposed)
          setLoadError(
            cause instanceof Error ? cause.message : "Не удалось получить предпросмотры",
          );
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

  async function command(branch: string, action: "delete" | "stop") {
    setPending(branch);
    setActionError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/previews`, {
        method: action === "delete" ? "DELETE" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, ...(action === "stop" ? { action: "stop" } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось выполнить действие");
      setPreviews(
        (items) =>
          items?.map((item) =>
            item.branch === branch ? { ...item, status: result.status } : item,
          ) ?? null,
      );
      if (action === "delete") setDeleteTarget(null);
    } catch (cause) {
      setActionError(cause instanceof Error ? cause.message : "Не удалось выполнить действие");
    } finally {
      setPending(null);
    }
  }

  return (
    <>
      {loadError || (actionError && !deleteTarget) ? (
        <p role="alert" className="danger-icon">
          {loadError || actionError}
        </p>
      ) : null}
      {previews === null ? (
        <p role="status">Загружаем предпросмотры…</p>
      ) : previews.length === 0 ? (
        <p className="panel-note">
          Предпросмотров пока нет. Запустите предпросмотр в документах нужной ветки.
        </p>
      ) : (
        <div className="preview-list">
          {previews.map((item) => {
            const isExpanded = item.isDefault || expanded.has(item.branch);
            const contentId = `preview-${encodeURIComponent(item.branch)}`;
            return (
              <article className="preview-card" key={item.branch}>
                <div className="preview-card-heading">
                  {item.isDefault ? (
                    <h2>
                      {item.branch}
                      <span className="preview-default">Основная ветка</span>
                    </h2>
                  ) : (
                    <button
                      className="preview-card-toggle"
                      type="button"
                      aria-expanded={isExpanded}
                      aria-controls={contentId}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(item.branch)) next.delete(item.branch);
                          else next.add(item.branch);
                          return next;
                        })
                      }
                    >
                      <ChevronDown
                        className={isExpanded ? "preview-chevron expanded" : "preview-chevron"}
                        aria-hidden
                        size={16}
                      />
                      <span>{item.branch}</span>
                    </button>
                  )}
                  <span className={`preview-state preview-state--${item.status}`} role="status">
                    {statuses[item.status] ?? item.status}
                  </span>
                </div>
                <div id={contentId} hidden={!isExpanded}>
                  <dl className="preview-metadata">
                    <div>
                      <dt>Создан</dt>
                      <dd>
                        {date(
                          item.readyAt ??
                            (item.status === "deployed" || item.status === "ready"
                              ? item.createdAt
                              : null),
                        )}
                      </dd>
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
                        {item.isDefault
                          ? "Не удаляется"
                          : item.expiresAt
                            ? date(item.expiresAt)
                            : item.status === "ready" ||
                                item.status === "updating" ||
                                item.status === "queued" ||
                                item.status === "starting"
                              ? "Через сутки после остановки"
                              : "—"}
                      </dd>
                    </div>
                    <div>
                      <dt>Место на диске</dt>
                      <dd className="preview-disk-value">
                        {item.diskBytes === null ? (
                          <span
                            className="preview-disk-skeleton skeleton-block"
                            role="status"
                            aria-label="Размер на диске загружается"
                          />
                        ) : (
                          <span>
                            {(item.diskBytes / 1_000_000_000).toLocaleString("ru-RU", {
                              minimumFractionDigits: 1,
                              maximumFractionDigits: 1,
                            })}{" "}
                            ГБ
                          </span>
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt>Неотправленные изменения</dt>
                      <dd>{item.changedFiles} файлов</dd>
                    </div>
                    <div>
                      <dt>URL</dt>
                      <dd>{item.url ? <code>{item.url}</code> : "Назначится при запуске"}</dd>
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
                    {item.status === "ready" || item.status === "updating" ? (
                      <button
                        className="pd-button pd-button--secondary"
                        type="button"
                        disabled={pending === item.branch}
                        onClick={() => void command(item.branch, "stop")}
                      >
                        <Pause aria-hidden size={15} />
                        Остановить
                      </button>
                    ) : null}
                    {canDelete && !item.isDefault ? (
                      <button
                        className="pd-button pd-button--danger"
                        type="button"
                        disabled={item.status === "deleting" || pending === item.branch}
                        onClick={() => {
                          setActionError("");
                          setDeleteTarget(item.branch);
                        }}
                      >
                        <Trash2 aria-hidden size={15} />
                        Удалить
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {deleteTarget ? (
        <SettingsModal
          title="Удалить предпросмотр?"
          confirmDiscard={false}
          onClose={() => {
            if (!pending) {
              setDeleteTarget(null);
              setActionError("");
            }
          }}
        >
          <DeleteConfirmation
            branch={deleteTarget}
            pending={pending === deleteTarget}
            error={actionError}
            onConfirm={() => void command(deleteTarget, "delete")}
          />
        </SettingsModal>
      ) : null}
    </>
  );
}
