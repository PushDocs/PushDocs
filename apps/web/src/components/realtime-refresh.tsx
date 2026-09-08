"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

const refreshEvents = [
  "attachment.ready",
  "branch.synchronized",
  "change-set.conflicted",
  "change-set.failed",
  "change-set.submitted",
  "change-set.submitting",
  "comment.created",
  "conflict.resolved",
  "document.created",
  "files.staged",
  "member.joined",
  "project.created",
  "reviews.synchronized",
];

export function RealtimeRefresh() {
  const router = useRouter();

  useEffect(() => {
    const source = new EventSource("/events");
    let timer: number | undefined;
    const refresh = () => {
      window.dispatchEvent(new Event("pushdocs:refresh"));
      window.clearTimeout(timer);
      timer = window.setTimeout(() => router.refresh(), 180);
    };
    for (const event of refreshEvents) source.addEventListener(event, refresh);
    return () => {
      window.clearTimeout(timer);
      source.close();
    };
  }, [router]);

  return null;
}
