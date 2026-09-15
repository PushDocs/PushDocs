"use client";
import { useCallback, useEffect, useRef, useState } from "react";

export interface FileComment {
  id: string;
  body: string;
  author_name: string;
  unread?: boolean;
}

export function useFileComments({
  projectId,
  branch,
  path,
  active = false,
  enabled = true,
}: {
  projectId: string;
  branch: string;
  path: string;
  active?: boolean;
  enabled?: boolean;
}) {
  const endpoint = `/api/projects/${projectId}/comments`;
  const scope = `${projectId}:${branch}:${path}`;
  const [snapshot, setSnapshot] = useState<{ scope: string; comments: FileComment[] }>({
    scope,
    comments: [],
  });
  const comments = snapshot.scope === scope ? snapshot.comments : [];
  const [error, setError] = useState("");
  const generation = useRef(0);
  const lifetime = useRef<{ scope: string; controller: AbortController } | null>(null);
  const confirmedReads = useRef<{ scope: string; ids: Set<string> }>({ scope, ids: new Set() });
  const [visible, setVisible] = useState(true);
  const refresh = useCallback(
    async (signal?: AbortSignal) => {
      if (!enabled || !path || lifetime.current?.scope !== scope) return;
      const requestId = ++generation.current;
      const response = await fetch(`${endpoint}?${new URLSearchParams({ branch, path })}`, {
        signal,
        cache: "no-store",
      });
      if (!response.ok) throw new Error("Не удалось получить комментарии");
      const result: FileComment[] = await response.json();
      if (!signal?.aborted && requestId === generation.current) {
        const readIds =
          confirmedReads.current.scope === scope ? confirmedReads.current.ids : new Set<string>();
        setSnapshot({
          scope,
          comments: result.map((comment) =>
            readIds.has(comment.id) ? { ...comment, unread: false } : comment,
          ),
        });
        setError("");
      }
    },
    [endpoint, branch, path, scope, enabled],
  );

  useEffect(() => {
    if (!enabled || !path) return;
    const controller = new AbortController();
    lifetime.current = { scope, controller };
    confirmedReads.current = { scope, ids: new Set() };
    const update = (event?: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      const eventProjectId = detail?.projectId ?? detail?.payload?.projectId;
      if (eventProjectId && eventProjectId !== projectId) return;
      if (detail?.payload?.branch && detail.payload.branch !== branch) return;
      if (detail?.payload?.documentPath && detail.payload.documentPath !== path) return;
      void refresh(controller.signal).catch(() => {
        if (!controller.signal.aborted)
          setError("Комментарии недоступны. Повторим загрузку автоматически.");
      });
    };
    const onVisibility = () => {
      const nextVisible = document.visibilityState === "visible";
      setVisible(nextVisible);
      if (nextVisible) update();
    };
    setVisible(document.visibilityState === "visible");
    update();
    window.addEventListener("pushdocs:refresh", update);
    window.addEventListener("online", update);
    window.addEventListener("pushdocs:realtime-connected", update);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", onVisibility);
    // Catch up after a dropped realtime event, including a reconnect without a new event.
    const timer = window.setInterval(update, 30000);
    return () => {
      controller.abort();
      generation.current += 1;
      window.clearInterval(timer);
      window.removeEventListener("pushdocs:refresh", update);
      window.removeEventListener("online", update);
      window.removeEventListener("pushdocs:realtime-connected", update);
      window.removeEventListener("focus", update);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [refresh, projectId, branch, path, enabled, scope]);

  const unreadIds = comments.filter((comment) => comment.unread).map((comment) => comment.id);
  const unreadKey = JSON.stringify(unreadIds);
  useEffect(() => {
    if (!enabled || !active || !visible || unreadKey === "[]") return;
    const controller = new AbortController();
    let retry: number | undefined;
    const commentIds: string[] = JSON.parse(unreadKey);
    const mark = () => {
      void fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, path, commentIds: commentIds.slice(0, 1000) }),
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) throw new Error("Не удалось отметить комментарии прочитанными");
          const { readIds }: { readIds: string[] } = await response.json();
          if (controller.signal.aborted) return;
          const marked = new Set(readIds);
          if (confirmedReads.current.scope === scope)
            for (const id of readIds) confirmedReads.current.ids.add(id);
          setSnapshot((current) =>
            current.scope === scope
              ? {
                  ...current,
                  comments: current.comments.map((comment) =>
                    marked.has(comment.id) ? { ...comment, unread: false } : comment,
                  ),
                }
              : current,
          );
        })
        .catch(() => {
          if (!controller.signal.aborted) retry = window.setTimeout(mark, 5000);
        });
    };
    mark();
    return () => {
      controller.abort();
      window.clearTimeout(retry);
    };
  }, [endpoint, branch, path, scope, unreadKey, active, visible, enabled]);

  return {
    comments,
    unreadCount: unreadIds.length,
    error,
    refresh: () =>
      refresh(lifetime.current?.scope === scope ? lifetime.current.controller.signal : undefined),
  };
}
export type FileCommentsState = ReturnType<typeof useFileComments>;
