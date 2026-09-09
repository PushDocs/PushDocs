"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
export function SitePreview({
  projectId,
  branch,
  revision,
  canBuild,
}: {
  projectId: string;
  branch: string;
  revision: number;
  canBuild: boolean;
}) {
  const [state, setState] = useState<{
    configured: boolean;
    revision?: number;
    sha?: string;
    changeStatus?: string;
    builds: Array<{
      id: string;
      sha: string;
      revision: number;
      status: string;
      log: string;
      stale: boolean;
      url: string | null;
    }>;
  }>({ configured: true, builds: [] });
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [automatic, setAutomatic] = useState(false);
  const attempted = useRef("");
  const inFlight = useRef(false);
  const endpoint = `/api/projects/${projectId}/preview`;
  const load = useCallback(async () => {
    const response = await fetch(`${endpoint}?${new URLSearchParams({ branch })}`);
    const result = await response.json();
    if (!response.ok) throw new Error(result.error);
    setState(result);
  }, [endpoint, branch]);
  useEffect(() => {
    const update = () => {
      void load().catch((cause) => setError(String(cause)));
    };
    update();
    const timer = setInterval(update, 5000);
    return () => clearInterval(timer);
  }, [load]);
  const currentRevision = state.revision ?? revision;
  const snapshotKey = `${state.sha}:${currentRevision}`;
  const buildPending = state.builds.some((build) => ["queued", "building"].includes(build.status));
  const disabled =
    !state.configured ||
    !canBuild ||
    busy ||
    buildPending ||
    (state.changeStatus !== undefined && state.changeStatus !== "open");
  const build = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    attempted.current = snapshotKey;
    setBusy(true);
    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, revision: currentRevision }),
      });
      if (!response.ok) throw new Error((await response.json()).error);
      setError("");
      await load();
    } catch (cause) {
      setError(String(cause));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }, [endpoint, branch, currentRevision, snapshotKey, load]);
  const hasSnapshot = state.builds.some(
    (item) => item.sha === state.sha && item.revision === currentRevision,
  );
  useEffect(() => {
    if (!automatic || disabled || hasSnapshot || attempted.current === snapshotKey) return;
    const timer = setTimeout(() => {
      void build();
    }, 8000);
    return () => clearTimeout(timer);
  }, [automatic, disabled, hasSnapshot, snapshotKey, build]);
  return (
    <div className="page preview-screen">
      <header className="page-header">
        <div>
          <p className="eyebrow">{branch}</p>
          <h1>Предпросмотр сайта</h1>
        </div>
        <Link
          className="pd-button pd-button--secondary"
          href={`/projects/${projectId}/documents?${new URLSearchParams({ branch })}`}
        >
          Вернуться в редактор
        </Link>
      </header>
      {!state.configured ? (
        <p className="wb-alert">
          Предпросмотр сайта не настроен. Обратитесь к оператору или откройте просмотр документа в
          редакторе.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="wb-alert">
          {error}
        </p>
      ) : null}
      <button
        className="pd-button pd-button--primary"
        type="button"
        disabled={disabled}
        onClick={() => void build()}
      >
        Собрать текущие черновики
      </button>
      <label className="wb-checkbox">
        <input
          type="checkbox"
          checked={automatic}
          disabled={!canBuild || !state.configured}
          onChange={(event) => setAutomatic(event.target.checked)}
        />
        Обновлять после сохранения
      </label>

      {!state.builds.length ? <p>Для этой ветки ещё нет сборок.</p> : null}
      {state.builds.map((build) => (
        <section key={build.id} className="wb-preview-build">
          <h2>
            {{
              queued: "В очереди",
              building: "Собираем сайт",
              ready: "Готово",
              failed: "Ошибка сборки",
            }[build.status] ?? build.status}
            {build.stale ? " (снимок устарел)" : ""}
          </h2>

          {build.url ? (
            <a
              className="pd-button pd-button--primary"
              href={build.url}
              target="_blank"
              rel="noreferrer"
            >
              Открыть сайт
            </a>
          ) : null}
          <details>
            <summary>Журнал сборки</summary>
            <p>
              Git {build.sha.slice(0, 8)}, ревизия черновиков {build.revision}
            </p>
            <pre>{build.log || "Ожидаем runner…"}</pre>
          </details>
        </section>
      ))}
    </div>
  );
}
