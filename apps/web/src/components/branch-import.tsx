"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { gitOperationStatusAction, synchronizeBranchAction } from "@/app/actions";
import { ProjectContext } from "./project-context";

export function BranchImport({ projectId, branch }: { projectId: string; branch: string }) {
  const router = useRouter();
  const requestRef = useRef<{ attempt: number; promise: Promise<string> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let pollTimer: ReturnType<typeof setTimeout> | undefined;
    const timeout = setTimeout(() => {
      active = false;
      clearTimeout(pollTimer);
      setError("Ветка ещё не загрузилась. Попробуйте повторить загрузку.");
    }, 300_000);
    const data = new FormData();
    data.set("projectId", projectId);
    data.set("branch", branch);
    if (requestRef.current?.attempt !== attempt) {
      requestRef.current = { attempt, promise: synchronizeBranchAction(data) };
    }
    const request = requestRef.current.promise;
    void request
      .then((jobId) => {
        if (!active) return;
        const poll = async () => {
          try {
            const job = await gitOperationStatusAction(projectId, jobId);
            if (!active) return;
            if (job.status === "done") {
              active = false;
              clearTimeout(timeout);
              router.refresh();
              return;
            }
            if (job.status === "failed") {
              active = false;
              clearTimeout(timeout);
              setError("Не удалось загрузить ветку. Проверьте подключение и повторите попытку.");
              return;
            }
            pollTimer = setTimeout(poll, 2000);
          } catch {
            if (!active) return;
            pollTimer = setTimeout(poll, 5000);
          }
        };
        void poll();
      })
      .catch(() => {
        if (!active) return;
        active = false;
        clearTimeout(timeout);
        setError("Не удалось загрузить ветку. Проверьте подключение и повторите попытку.");
      });
    return () => {
      active = false;
      clearTimeout(pollTimer);
      clearTimeout(timeout);
    };
  }, [projectId, branch, router, attempt]);

  return (
    <section className="page branch-import">
      <ProjectContext projectId={projectId} branch={branch} />
      <header className="page-header">
        <h1>{branch}</h1>
      </header>
      {error ? (
        <>
          <p role="alert">{error}</p>
          <button
            className="pd-button pd-button--primary"
            type="button"
            onClick={() => {
              setError("");
              setAttempt((value) => value + 1);
            }}
          >
            Повторить загрузку
          </button>
        </>
      ) : (
        <div className="branch-import-loading">
          <p role="status">Загружаем файлы ветки…</p>
          <div
            className="branch-import-progress"
            role="progressbar"
            aria-label="Загрузка файлов ветки"
          >
            <span />
          </div>
        </div>
      )}
    </section>
  );
}
