"use client";

import { CircleAlert, ExternalLink, LoaderCircle, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

type PreviewState = {
  error?: string | null;
  message?: string;
  sessionId?: string;
  status: "queued" | "starting" | "ready" | "failed" | "stopped" | "deleting";
  url?: string;
  waitingForCapacity?: boolean;
  manuallyStopped?: boolean;
};
type Props = {
  projectId: string;
  branch: string;
  autoStart?: boolean;
  onReady?: (url: string | null) => void;
};

export function LivePreviewButton(props: Props) {
  return <PreviewControl key={`${props.projectId}:${props.branch}`} {...props} />;
}

function PreviewControl({ projectId, branch, autoStart = false, onReady }: Props) {
  const [state, setState] = useState<PreviewState>({ status: "stopped" });
  const [requested, setRequested] = useState(autoStart);
  const [attempt, setAttempt] = useState(0);
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const sessionId = useRef<string | undefined>(undefined);
  const endpoint = `/api/projects/${projectId}/preview`;
  const command = useCallback(
    async (action: "acquire" | "heartbeat" | "release", keepalive = false) => {
      const response = await fetch(`${endpoint}?attempt=${attempt}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branch, clientId, sessionId: sessionId.current }),
        keepalive,
      });
      const result = (await response.json()) as PreviewState;
      if (!response.ok) throw new Error(result.error ?? "Не удалось запустить предпросмотр");
      if (result.sessionId) sessionId.current = result.sessionId;
      return result;
    },
    [attempt, branch, clientId, endpoint],
  );
  const readStatus = useCallback(async () => {
    const response = await fetch(`${endpoint}?${new URLSearchParams({ branch })}`, {
      cache: "no-store",
    });
    const result = (await response.json()) as PreviewState;
    if (!response.ok) throw new Error(result.error ?? "Не удалось получить статус");
    return result;
  }, [branch, endpoint]);

  useEffect(() => {
    onReady?.(state.status === "ready" ? (state.url ?? null) : null);
  }, [state.status, state.url, onReady]);
  useEffect(() => {
    let disposed = false;
    let fetching = false;
    let queuedSince = Date.now();
    const fail = (cause: unknown) => {
      if (!disposed)
        setState({
          status: "failed",
          error: cause instanceof Error ? cause.message : "Не удалось получить статус",
        });
    };
    const refresh = async () => {
      if (fetching) return;
      fetching = true;
      try {
        let result = await readStatus();
        if (disposed) return;
        if (requested && result.status === "stopped" && !result.manuallyStopped) {
          result = await command("acquire");
          queuedSince = Date.now();
        } else if (result.manuallyStopped || result.status === "deleting") {
          setRequested(false);
        }
        if (disposed) return;
        if (
          requested &&
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
      } catch (cause) {
        fail(cause);
      } finally {
        fetching = false;
      }
    };
    const start = async () => {
      if (!requested) {
        await refresh();
        return;
      }
      fetching = true;
      try {
        setState({ status: "queued" });
        const result = await command("acquire");
        if (disposed) {
          await command("release", true).catch(() => undefined);
          return;
        }
        setState(result);
      } catch (cause) {
        fail(cause);
      } finally {
        fetching = false;
      }
    };
    void start();
    const statusTimer = setInterval(() => void refresh(), 1500);
    const heartbeatTimer = requested
      ? setInterval(() => void command("heartbeat").catch(() => undefined), 15_000)
      : undefined;
    return () => {
      disposed = true;
      clearInterval(statusTimer);
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (requested && sessionId.current) void command("release", true).catch(() => undefined);
    };
  }, [command, readStatus, requested]);

  function start() {
    setDismissedError(null);
    setState({ status: "queued" });
    setRequested(true);
    setAttempt((value) => value + 1);
  }

  if (state.status === "ready" && state.url)
    return (
      <a
        className="pd-button pd-button--secondary"
        href={`/projects/${projectId}/previews/view?${new URLSearchParams({ branch })}`}
        target="_blank"
        rel="noreferrer"
        title={`Открыть предпросмотр ветки ${branch}`}
        onClick={(event) => {
          event.preventDefault();
          const tab = window.open("about:blank", "_blank");
          if (tab) tab.opener = null;
          void (requested ? readStatus() : command("acquire"))
            .then((result) => {
              setState(result);
              if (!requested) setRequested(true);
              if (result.status === "ready" && result.url && tab) tab.location.replace(result.url);
              else tab?.close();
            })
            .catch((cause) => {
              tab?.close();
              setState({ status: "failed", error: String(cause) });
            });
        }}
      >
        Открыть предпросмотр
        <ExternalLink aria-hidden size={15} />
      </a>
    );

  if (state.status === "stopped" || state.status === "failed") {
    const error = state.error;
    return (
      <>
        <button
          className="pd-button live-preview-start"
          type="button"
          onClick={start}
          aria-label={`Запустить предпросмотр ветки ${branch}`}
        >
          <Play aria-hidden size={15} />
          Предпросмотр
        </button>
        {error && dismissedError !== error ? (
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
        aria-label={
          state.status === "deleting"
            ? `Предпросмотр ветки ${branch} в процессе удаления`
            : `Предпросмотр ветки ${branch} запускается`
        }
      >
        <LoaderCircle className="spin" aria-hidden size={15} />
        {state.status === "deleting"
          ? "В процессе удаления"
          : state.waitingForCapacity
            ? "Предпросмотр: очередь"
            : state.status === "queued"
              ? "В очереди"
              : state.message?.startsWith("Обновляем")
                ? "Обновляется"
                : "В процессе создания"}
      </button>
      <span className="sr-only" role="status">
        {state.message ||
          (state.status === "deleting" ? "В процессе удаления" : "Ставим запуск в очередь…")}
      </span>
    </span>
  );
}
