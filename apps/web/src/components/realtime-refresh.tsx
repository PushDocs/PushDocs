"use client";

import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

const localEvents = ["attachment.ready", "comment.created", "document.created", "files.staged"];
const routeEvents = [
  "branch.synchronized",
  "change-set.conflicted",
  "change-set.failed",
  "change-set.submitted",
  "change-set.submitting",
  "conflict.resolved",
  "member.joined",
  "project.created",
  "reviews.synchronized",
];

export function RealtimeRefresh() {
  const router = useRouter();
  const pathname = usePathname();
  const projectId = pathname.match(/^\/projects\/([^/]+)/)?.[1];
  const [disconnected, setDisconnected] = useState(false);

  useEffect(() => {
    const source = new EventSource(
      projectId ? `/events?${new URLSearchParams({ projectId })}` : "/events",
    );
    let timer: number | undefined;
    source.onopen = () => setDisconnected(false);
    source.onerror = () => setDisconnected(true);
    const dispatch = (event: Event) => {
      let detail: Record<string, unknown> = { type: event.type };
      if (event instanceof MessageEvent)
        try {
          detail = { ...detail, ...JSON.parse(String(event.data)) };
        } catch {}
      window.dispatchEvent(new CustomEvent("pushdocs:refresh", { detail }));
    };
    const refresh = (event: Event) => {
      dispatch(event);
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 180);
    };
    for (const event of localEvents) source.addEventListener(event, dispatch);
    for (const event of routeEvents) source.addEventListener(event, refresh);
    return () => {
      window.clearTimeout(timer);
      source.close();
    };
  }, [router, projectId]);

  return disconnected ? (
    <div className="connection-banner" role="status">
      Связь с сервером прервана. Изменения остаются в браузере, подключение восстанавливается…
    </div>
  ) : null;
}
