"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { DiffViewer } from "./diff-viewer";
import { clearDraft, draftKey, readDraft } from "./draft-storage";
import { diffRevertLabels } from "./text-diff";

export function RevertDiff({
  projectId,
  branch,
  path,
  before,
  after,
  revision,
  headSha,
  ownerId,
  lineHref,
  revealLine,
}: {
  projectId: string;
  branch: string;
  path: string;
  before: string;
  after: string;
  revision: number;
  headSha: string;
  ownerId: string;
  lineHref?: (line: number) => string;
  revealLine?: number;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const revert = useCallback(
    async (lineIds: number[]) => {
      if (inFlight.current || done || conflict) return;
      inFlight.current = true;
      setPending(true);
      setError("");
      try {
        const response = await fetch(`/api/projects/${projectId}/changes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            branch,
            path,
            expectedRevision: revision,
            expectedHeadSha: headSha,
            lineIds,
          }),
        });
        if (response.status === 409) {
          setConflict(true);
          return;
        }
        const result = await response.json().catch(() => null);
        if (!response.ok) throw new Error(result?.error || diffRevertLabels.failure);
        const key = draftKey(projectId, branch, path, ownerId);
        const draft = readDraft(key);
        // Keep recovery copies containing edits that were not part of this comparison.
        if (draft && (draft.text === after || draft.text === result?.content)) clearDraft(key);
        setDone(true);
        router.refresh();
      } catch (error) {
        setError(error instanceof Error ? error.message : diffRevertLabels.failure);
      } finally {
        inFlight.current = false;
        setPending(false);
      }
    },
    [projectId, branch, path, revision, headSha, ownerId, after, router, done, conflict],
  );
  return (
    <>
      {pending || done ? (
        <p role="status">{pending ? "Откатываем…" : "Фрагмент отменён."}</p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {conflict ? (
        <div role="alert">
          Изменения обновились. Обновите страницу перед откатом.
          <button type="button" onClick={() => router.refresh()}>
            Обновить
          </button>
        </div>
      ) : null}
      <DiffViewer
        path={path}
        before={before}
        after={after}
        onRevert={revert}
        revertDisabled={pending || done || conflict}
        lineHref={lineHref}
        revealLine={revealLine}
      />
    </>
  );
}
