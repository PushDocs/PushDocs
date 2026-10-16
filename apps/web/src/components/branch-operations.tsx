"use client";

import { Download, GitMerge } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { gitOperationStatusAction, startGitOperationAction } from "@/app/actions";

export function BranchOperations({
  projectId,
  branch,
  defaultBranch,
  canMerge,
  disabled,
  beforeStart,
  onComplete,
  onBusyChange,
}: {
  projectId: string;
  branch: string;
  defaultBranch?: string;
  canMerge: boolean;
  disabled: boolean;
  beforeStart: () => Promise<boolean>;
  onComplete: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const [busy, setBusy] = useState(false);
  const starting = useRef(false);
  const [job, setJob] = useState<{ id: string; merge: boolean }>();
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const callbacks = useRef({ beforeStart, onComplete, onBusyChange });
  callbacks.current = { beforeStart, onComplete, onBusyChange };

  useEffect(() => {
    if (!job) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await gitOperationStatusAction(projectId, job.id);
        if (stopped) return;
        if (result.status === "done" || result.status === "failed") {
          setError(result.status === "failed");
          setMessage(
            result.status === "failed"
              ? result.last_error || "Операция не завершена. Повторите попытку."
              : job.merge
                ? `${defaultBranch} влита в ${branch}`
                : `Ветка ${branch} обновлена из Git`,
          );
          if (result.status === "done") {
            try {
              await callbacks.current.onComplete();
            } catch {
              if (!stopped) {
                setError(true);
                setMessage(
                  "Операция в Git завершена, но документы не удалось перечитать. Обновите страницу.",
                );
              }
            }
          }
          if (!stopped) {
            setJob(undefined);
            starting.current = false;
            setBusy(false);
            callbacks.current.onBusyChange?.(false);
          }
          return;
        }
        timer = setTimeout(poll, 2000);
      } catch {
        if (stopped) return;
        setMessage("Нет связи с сервером. Проверяем результат…");
        timer = setTimeout(poll, 5000);
      }
    };
    void poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
      callbacks.current.onBusyChange?.(false);
    };
  }, [job, projectId, branch, defaultBranch]);

  async function start(merge: boolean) {
    if (starting.current) return;
    starting.current = true;
    setBusy(true);
    setError(false);
    setMessage("");
    try {
      if (!(await callbacks.current.beforeStart())) {
        starting.current = false;
        setBusy(false);
        setError(true);
        setMessage("Сначала сохраните изменения в редакторе.");
        return;
      }
      callbacks.current.onBusyChange?.(true);
      const id = await startGitOperationAction({
        projectId,
        branch,
        ...(merge ? { mergeDefault: true } : {}),
      });
      setMessage(merge ? `Вливаем ${defaultBranch} в ${branch}…` : `Обновляем ${branch}…`);
      setJob({ id, merge });
    } catch {
      callbacks.current.onBusyChange?.(false);
      starting.current = false;
      setBusy(false);
      setError(true);
      setMessage("Не удалось начать операцию. Повторите попытку.");
    }
  }

  return (
    <div className="wb-branch-operations">
      <button
        type="button"
        className="pd-button pd-button--secondary"
        disabled={busy || disabled}
        title={`Получить свежую версию ${branch} из Git в PushDocs`}
        onClick={() => void start(false)}
      >
        <Download size={16} aria-hidden /> {busy ? "Обновляем ветку…" : "Обновить из Git"}
      </button>
      {canMerge && defaultBranch && branch !== defaultBranch ? (
        <details className="wb-disclosure wb-merge-menu">
          <summary aria-label={`Влить ${defaultBranch} в ${branch}`}>
            <GitMerge size={16} aria-hidden /> Влить {defaultBranch}…
          </summary>
          <div className="wb-popover">
            <p>
              Свежие изменения {defaultBranch} будут влиты в {branch} и отправлены в Git. PR / MR не
              требуется. Черновики останутся в PushDocs.
            </p>
            <button
              type="button"
              className="pd-button pd-button--secondary"
              disabled={busy || disabled}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void start(true);
              }}
            >
              Влить в {branch}
            </button>
          </div>
        </details>
      ) : null}
      {message ? <p role={error ? "alert" : "status"}>{message}</p> : null}
    </div>
  );
}
