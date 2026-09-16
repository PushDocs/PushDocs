"use client";

import { ExternalLink, LoaderCircle, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";

type PreviewState = {
  error?: string | null;
  log?: string;
  message?: string;
  sessionId?: string;
  status: "queued" | "starting" | "ready" | "failed" | "stopped";
  url?: string;
};

export function LivePreviewButton({ projectId, branch }: { projectId: string; branch: string }) {
  const [state, setState] = useState<PreviewState>({ status: "queued" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const endpoint = `/api/projects/${projectId}/preview?attempt=${attempt}`;
    const clientId = crypto.randomUUID();
    let sessionId: string | undefined;
    let disposed = false;
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
            if (!disposed) setState(result);
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
      >
        Предпросмотр
        <ExternalLink aria-hidden size={15} />
      </a>
    );

  if (state.status === "failed" || state.status === "stopped")
    return (
      <span className="live-preview-error" title={state.log || state.error || undefined}>
        <button
          className="pd-button pd-button--secondary"
          type="button"
          onClick={() => setAttempt((value) => value + 1)}
        >
          Повторить предпросмотр
          <RefreshCw aria-hidden size={15} />
        </button>
        <small role="status">
          {state.error || "Предпросмотр остановлен. Запустите его снова."}
        </small>
      </span>
    );

  return (
    <span className="live-preview-progress">
      <button className="pd-button pd-button--secondary" type="button" disabled>
        <LoaderCircle className="spin" aria-hidden size={15} />
        Запуск предпросмотра…
      </button>
      <small role="status">{state.message || "Ставим запуск в очередь…"}</small>
    </span>
  );
}
