"use client";
import { MessageSquare } from "lucide-react";
import { useState } from "react";
import { type FileCommentsState, useFileComments } from "./use-file-comments";

export function FileComments({
  projectId,
  branch,
  path,
  active = true,
  state,
}: {
  projectId: string;
  branch: string;
  path: string;
  active?: boolean;
  state?: FileCommentsState;
}) {
  const localState = useFileComments({ projectId, branch, path, active, enabled: !state });
  const { comments, refresh, error: loadError } = state ?? localState;
  const [body, setBody] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const endpoint = `/api/projects/${projectId}/comments`;
  return (
    <section className="wb-comments">
      <h2>Комментарии PushDocs</h2>
      {comments.map((comment) => (
        <article key={comment.id}>
          <strong>{comment.author_name}</strong>
          <p>{comment.body}</p>
        </article>
      ))}
      {error || loadError ? <p role="alert">{error || loadError}</p> : null}
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
          <textarea
            aria-label="Новый комментарий"
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

export function FileCommentsButton({
  open,
  unreadCount,
  onToggle,
}: {
  open: boolean;
  unreadCount: number;
  onToggle: () => void;
}) {
  return (
    <button type="button" aria-expanded={open} aria-controls="wb-comment-panel" onClick={onToggle}>
      <MessageSquare size={16} aria-hidden /> Комментарии
      {unreadCount > 0 ? (
        <span
          className="wb-comment-count"
          role="status"
          aria-live="polite"
          aria-label={`${unreadCount} непрочитанных комментариев`}
        >
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      ) : null}
    </button>
  );
}
