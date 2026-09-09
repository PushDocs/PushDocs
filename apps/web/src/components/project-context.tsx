"use client";
import { useEffect } from "react";

export function readProjectBranch(projectId: string, fallback: string) {
  try {
    return sessionStorage.getItem(`pushdocs:branch:${projectId}`) || fallback;
  } catch {
    return fallback;
  }
}
export function rememberProjectBranch(projectId: string, branch: string) {
  try {
    sessionStorage.setItem(`pushdocs:branch:${projectId}`, branch);
  } catch {
    /* Optional browser storage. */
  }
  window.dispatchEvent(new Event("pushdocs:context"));
}
export function documentHref(projectId: string, branch: string) {
  const query = new URLSearchParams({ branch });
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(`pushdocs:tabs:${projectId}:${branch}`) ?? "null",
    );
    if (typeof cached?.selected === "string" && cached.selected) query.set("path", cached.selected);
  } catch {
    /* Optional browser storage. */
  }
  return `/projects/${projectId}/documents?${query}`;
}
export function ProjectContext({ projectId, branch }: { projectId: string; branch: string }) {
  useEffect(() => rememberProjectBranch(projectId, branch), [projectId, branch]);
  return null;
}
