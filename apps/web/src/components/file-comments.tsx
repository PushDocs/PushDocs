"use client";
import { useCallback, useEffect, useState } from "react";

export function FileComments({
  projectId,
  branch,
  path,
}: {
  projectId: string;
  branch: string;
  path: string;
}) {
  const [comments, setComments] = useState<
    Array<{ id: string; body: string; author_name: string }>
  >([]);
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const endpoint = `/api/projects/${projectId}/comments`;
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      const response = await fetch(`${endpoint}?${new URLSearchParams({ branch, path })}`, {
        signal,
      });
      if (!response.ok) throw new Error("Не удалось получить комментарии");
      const result = await response.json();
      if (!signal?.aborted) setComments(result);
    },
    [endpoint, branch, path],
  );
  useEffect(() => {
    const controller = new AbortController();
    const update = () => {
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted)
          setError("Комментарии недоступны. Повторим загрузку автоматически.");
      });
    };
    update();
    const interval = setInterval(update, 10000);
    window.addEventListener("pushdocs:refresh", update);
    return () => {
      window.removeEventListener("pushdocs:refresh", update);
      controller.abort();
      clearInterval(interval);
    };
  }, [refresh]);
  return (
    <section className="wb-comments">
      <h2 title="Комментарии сохраняются в PushDocs и не отправляются в PR / MR">Комментарии</h2>
      {comments.map((comment) => (
        <article key={comment.id}>
          <strong>{comment.author_name}</strong>
          <p>{comment.body}</p>
        </article>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setPending(true);
          try {
            const response = await fetch(endpoint, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ branch, path, body }),
            });
            if (!response.ok) throw new Error((await response.json()).error);
            setBody("");
            setError("");
            await refresh();
          } catch (cause) {
            setError(String(cause));
          } finally {
            setPending(false);
          }
        }}
      >
        <label>
          Новый комментарий
          <textarea
            required
            maxLength={20000}
            value={body}
            onChange={(event) => setBody(event.target.value)}
          />
        </label>
        <button type="submit" disabled={pending || !body.trim()}>
          Отправить комментарий
        </button>
      </form>
    </section>
  );
}
