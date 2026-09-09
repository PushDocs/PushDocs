"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { synchronizeBranchAction } from "@/app/actions";

export function BranchImport({ projectId, branch }: { projectId: string; branch: string }) {
  const router = useRouter();
  const requestRef = useRef<{ attempt: number; promise: Promise<void> } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      active = false;
      clearInterval(interval);
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
      .then(() => {
        if (!active) return;
        router.refresh();
        interval = setInterval(() => router.refresh(), 2000);
      })
      .catch(() => {
        if (!active) return;
        clearTimeout(timeout);
        setError("Не удалось загрузить ветку. Проверьте подключение и повторите попытку.");
      });
    return () => {
      active = false;
      clearInterval(interval);
      clearTimeout(timeout);
    };
  }, [projectId, branch, router, attempt]);

  return (
    <section className="page">
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
        <p role="status">Загружаем файлы ветки…</p>
      )}
    </section>
  );
}
