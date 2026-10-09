"use client";

import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";

type PreviewState = {
  error?: string | null;
  log?: string;
  message?: string;
  sessionId?: string;
  status: "queued" | "starting" | "ready" | "failed" | "stopped";
  url?: string;
  waitingForCapacity?: boolean;
};

export function LivePreviewButton({
  projectId,
  branch,
  onReady,
}: {
  projectId: string;
  branch: string;
  onReady?: (url: string | null) => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "queued" });
  const [attempt, setAttempt] = useState(0);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  useEffect(() => {
    onReady?.(state.status === "ready" ? (state.url ?? null) : null);
  }, [state.status, state.url, onReady]);

  useEffect(() => {
    const endpoint = `/api/projects/${projectId}/preview?attempt=${attempt}`;
    const clientId = crypto.randomUUID();
    let sessionId: string | undefined;
    let disposed = false;
    let queuedSince = Date.now();
    let statusTimer: ReturnType<typeof setInterval> | undefined;
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const command = async (action: "acquire" | "heartbeat" | "release", keepalive = false) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action,
          branch,
          clientId,
          sessionId,
        }),
        keepalive,
      });
      const result = (await response.json()) as PreviewState & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Не удалось запустить предпросмотр");
      if (result.sessionId) sessionId = result.sessionId;
      return result;
    };
    const start = async () => {
      try {
        setState({ status: "queued" });
        const acquired = await command("acquire");
        queuedSince = Date.now();
        if (disposed) return;
        setState(acquired);
        statusTimer = setInterval(async () => {
          try {
            const response = await fetch(
              `/api/projects/${projectId}/preview?${new URLSearchParams({ branch })}`,
              { cache: "no-store" },
            );
            const result = (await response.json()) as PreviewState & { error?: string };
            if (!response.ok) throw new Error(result.error ?? "Не удалось получить статус");
            if (result.status === "stopped") {
              const reacquired = await command("acquire");
              queuedSince = Date.now();
              if (!disposed) setState(reacquired);
            } else if (!disposed) {
              if (
                result.status === "queued" &&
                !result.waitingForCapacity &&
                Date.now() - queuedSince > 30_000
              )
                setState({
                  ...result,
                  status: "failed",
                  error:
                    "Сервис предпросмотра не начал запуск за 30 секунд. Повторите попытку или проверьте его работу на сервере.",
                });
              else {
                if (result.status !== "queued") queuedSince = Date.now();
                setState(result);
              }
            }
          } catch (error) {
            if (!disposed)
              setState({
                status: "failed",
                error: error instanceof Error ? error.message : "Не удалось получить статус",
              });
          }
        }, 1500);
        heartbeatTimer = setInterval(() => {
          void command("heartbeat").catch(() => undefined);
        }, 15_000);
      } catch (error) {
        if (!disposed)
          setState({
            status: "failed",
            error: error instanceof Error ? error.message : "Не удалось запустить предпросмотр",
          });
      }
    };
    void start();
    return () => {
      disposed = true;
      if (statusTimer) clearInterval(statusTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (sessionId) void command("release", true).catch(() => undefined);
    };
  }, [attempt, branch, projectId]);

  if (state.status === "ready" && state.url)
    return (
      <a
        className="pd-button pd-button--secondary"
        href={state.url}
        target="_blank"
        rel="noreferrer"
        title={`Открыть предпросмотр ветки ${branch}`}
      >
        Предпросмотр
        <ExternalLink aria-hidden size={15} />
      </a>
    );

  if (state.status === "failed" || state.status === "stopped") {
    const error = state.error || "Предпросмотр остановлен. Запустите его снова.";
    return (
      <>
        <span className="live-preview-control">
          <button
            className="pd-button pd-button--secondary"
            type="button"
            title={
              state.error || state.log || "Предпросмотр остановлен. Нажмите, чтобы запустить снова."
            }
            aria-label={`Повторить предпросмотр ветки ${branch}`}
            onClick={() => {
              setDismissedError(null);
              setAttempt((value) => value + 1);
            }}
          >
            Предпросмотр
            <RefreshCw aria-hidden size={15} />
          </button>
        </span>
        {dismissedError !== error ? (
          <div
            className="settings-notification settings-notification--error live-preview-notification"
            role="alert"
          >
            <CircleAlert aria-hidden size={18} />
            <div className="live-preview-notification-content">
              <strong>Предпросмотр недоступен</strong>
              <p>{error}</p>
            </div>
            <button
              type="button"
              aria-label="Закрыть уведомление"
              onClick={() => setDismissedError(error)}
            >
              <X aria-hidden size={16} />
            </button>
          </div>
        ) : null}
      </>
    );
  }

  return (
    <span className="live-preview-control">
      <button
        className="pd-button pd-button--secondary"
        type="button"
        disabled
        title={`${branch}: ${state.message || "Готовим предпросмотр"}`}
        aria-label={`Предпросмотр ветки ${branch} запускается`}
      >
        <LoaderCircle className="spin" aria-hidden size={15} />
        {state.waitingForCapacity ? "Предпросмотр: очередь" : "Предпросмотр"}
      </button>
      <span className="sr-only" role="status">
        {state.message || "Ставим запуск в очередь…"}
      </span>
    </span>
  );
}
