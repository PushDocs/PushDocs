"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BranchFreshness } from "@/lib/branch-freshness";

export function useBranchFreshness({
  projectId,
  branch,
  headSha,
  remoteHeadSha,
  defaultBranch,
  enabled = true,
}: {
  projectId: string;
  branch: string;
  headSha?: string;
  remoteHeadSha?: string | null;
  defaultBranch?: string;
  enabled?: boolean;
}) {
  const scope = JSON.stringify([projectId, branch, headSha, remoteHeadSha, defaultBranch]);
  const activeScope = useRef(scope);
  activeScope.current = scope;
  const controller = useRef<AbortController | null>(null);
  const [snapshot, setSnapshot] = useState<{
    scope: string;
    checking: boolean;
    data: BranchFreshness | null;
  }>();
  const refresh = useCallback(async () => {
    if (!enabled || !headSha) return;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setSnapshot({ scope, checking: true, data: null });
    let data: BranchFreshness | null = null;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/branch-freshness?${new URLSearchParams({ branch })}`,
        { cache: "no-store", signal: request.signal },
      );
      if (response.ok) data = await response.json();
    } catch {
      // Unknown freshness exposes a check action, never a claim that the branch is current.
    }
    if (!request.signal.aborted && activeScope.current === scope)
      setSnapshot({ scope, checking: false, data });
  }, [projectId, branch, headSha, scope, enabled]);

  useEffect(() => {
    if (!enabled) return;
    void refresh();
    const onSynchronize = (event: Event) => {
      const detail = event instanceof CustomEvent ? event.detail : undefined;
      if (
        detail?.type === "branch.synchronized" &&
        detail.projectId === projectId &&
        (detail.payload?.branch === branch || detail.payload?.branch === defaultBranch)
      )
        void refresh();
    };
    window.addEventListener("pushdocs:refresh", onSynchronize);
    return () => {
      controller.current?.abort();
      window.removeEventListener("pushdocs:refresh", onSynchronize);
    };
  }, [projectId, branch, defaultBranch, enabled, refresh]);

  const current = snapshot?.scope === scope ? snapshot : undefined;
  const data = current?.data;
  return {
    remoteMissing: enabled && data?.remoteSha === null,
    filesCurrent:
      enabled && headSha && typeof data?.remoteSha === "string" && data.remoteSha
        ? data.remoteSha === headSha
        : null,
    includesDefaultBranch:
      enabled && typeof data?.includesDefaultBranch === "boolean"
        ? data.includesDefaultBranch
        : null,
    defaultBranch: data?.defaultBranch ?? defaultBranch,
    checking: current?.checking ?? false,
    refresh,
  };
}
