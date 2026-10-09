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
  const requested = useRef(autoStart);
  const ownsLease = useRef(false);
  const mounted = useRef(true);
  const queuedSince = useRef(Date.now());
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const [clientId] = useState(() => crypto.randomUUID());
  const sessionId = useRef<string | undefined>(undefined);
  const endpoint = `/api/projects/${projectId}/preview`;
  const command = useCallback(
    async (action: "acquire" | "attach" | "heartbeat" | "release", keepalive = false) => {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, branch, clientId, sessionId: sessionId.current }),
        keepalive,
      });
      const result = (await response.json()) as PreviewState;
      if (!response.ok) throw new Error(result.error ?? "Не удалось запустить предпросмотр");
      if (result.sessionId) sessionId.current = result.sessionId;
      if (action === "acquire" || action === "attach")
        ownsLease.current = Boolean(
          result.sessionId && ["queued", "starting", "ready"].includes(result.status),
        );
      return result;
    },
    [branch, clientId, endpoint],
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
    mounted.current = true;
    let fetching = false;
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
        if (requested.current && result.status === "stopped" && !result.manuallyStopped) {
          result = await command("acquire");
          queuedSince.current = Date.now();
        } else if (result.manuallyStopped || result.status === "deleting") {
          requested.current = false;
          ownsLease.current = false;
        } else if (
          !ownsLease.current &&
          result.sessionId &&
          ["queued", "starting", "ready"].includes(result.status)
        ) {
          result = await command("attach");
        }
        if (disposed) {
          if (ownsLease.current) {
            ownsLease.current = false;
            await command("release", true).catch(() => undefined);
          }
          return;
        }
        if (
          requested.current &&
          result.status === "queued" &&
          !result.waitingForCapacity &&
          Date.now() - queuedSince.current > 30_000
        )
          setState({
            ...result,
            status: "failed",
            error:
              "Сервис предпросмотра не начал запуск за 30 секунд. Повторите попытку или проверьте его работу на сервере.",
          });
        else {
          if (result.status !== "queued") queuedSince.current = Date.now();
          setState(result);
        }
      } catch (cause) {
        fail(cause);
      } finally {
        fetching = false;
      }
    };
    const start = async () => {
      if (!requested.current) {
        await refresh();
        return;
      }
      fetching = true;
      try {
        setState({ status: "queued" });
        const result = await command("acquire");
        if (disposed) {
          ownsLease.current = false;
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
    const heartbeatTimer = setInterval(() => {
      if (ownsLease.current)
        void command("heartbeat").catch(() => {
          ownsLease.current = false;
        });
    }, 15_000);
    const release = () => {
      if (ownsLease.current && sessionId.current) {
        ownsLease.current = false;
        void command("release", true).catch(() => undefined);
      }
    };
    window.addEventListener("pagehide", release);
    return () => {
      disposed = true;
      mounted.current = false;
      clearInterval(statusTimer);
      clearInterval(heartbeatTimer);
      window.removeEventListener("pagehide", release);
      release();
    };
  }, [command, readStatus]);

  function start() {
    setDismissedError(null);
    setState({ status: "queued" });
    requested.current = true;
    queuedSince.current = Date.now();
    void command("acquire")
      .then((result) => {
        if (mounted.current) setState(result);
        else {
          ownsLease.current = false;
          void command("release", true).catch(() => undefined);
        }
      })
      .catch((cause) => {
        if (mounted.current) setState({ status: "failed", error: String(cause) });
      });
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
          void (ownsLease.current ? readStatus() : command("acquire"))
            .then((result) => {
              setState(result);
              requested.current = true;
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
