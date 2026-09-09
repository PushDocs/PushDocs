"use client";
import { Download, GitPullRequest } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { gitOperationStatusAction, startGitOperationAction } from "@/app/actions";

export function GitOperation({
  projectId,
  branch,
  createReview = false,
  disabled = false,
}: {
  projectId: string;
  branch: string;
  createReview?: boolean;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [jobId, setJobId] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState(false);
  const [title, setTitle] = useState("");
  useEffect(() => {
    if (!jobId) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await gitOperationStatusAction(projectId, jobId);
        if (stopped) return;
        if (job.status === "done" || job.status === "failed") {
          setBusy(false);
          setJobId("");
          setError(job.status === "failed");
          setMessage(
            job.status === "done"
              ? createReview
                ? "PR / MR создан"
                : "Изменения получены"
              : "Операция не завершена. Повторите попытку.",
          );
          router.refresh();
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
    };
  }, [jobId, projectId, router, createReview]);
  return (
    <form
      className="git-operation"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError(false);
        setMessage("");
        try {
          setJobId(
            await startGitOperationAction({
              projectId,
              branch,
              ...(createReview ? { title } : {}),
            }),
          );
        } catch {
          setBusy(false);
          setError(true);
          setMessage("Не удалось начать операцию. Повторите попытку.");
        }
      }}
    >
      {createReview ? (
        <label>
          Название PR / MR
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            required
            minLength={3}
            maxLength={255}
            disabled={busy || disabled}
          />
        </label>
      ) : null}
      <button
        className={`pd-button pd-button--${createReview ? "primary" : "secondary"}`}
        type="submit"
        disabled={busy || disabled}
      >
        {createReview ? (
          <GitPullRequest aria-hidden size={16} />
        ) : (
          <Download aria-hidden size={16} />
        )}
        {busy
          ? createReview
            ? "Создаём PR / MR…"
            : "Получаем изменения…"
          : createReview
            ? "Создать PR / MR"
            : "Получить из Git"}
      </button>
      {message ? <p role={error ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}

export function SubmissionRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => router.refresh(), 2000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
