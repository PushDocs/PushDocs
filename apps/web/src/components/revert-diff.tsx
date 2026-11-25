"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { projectChangesApiPath } from "@/lib/project-paths";
import type { ReviewFile } from "./change-review";
import { useDiffRevertHistory } from "./diff-revert-history";
import { DiffViewer } from "./diff-viewer";
import { clearDraft, draftKey, readDraft } from "./draft-storage";
import { RevertConfirmation } from "./revert-confirmation";
import { type DiffRevertHandler, diffRevertLabels } from "./text-diff";

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
  reviewFile,
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
  reviewFile?: ReviewFile;
}) {
  const router = useRouter();
  const history = useDiffRevertHistory();
  const displayedAfter =
    history?.revision !== undefined && history.revision >= revision && history.headSha === headSha
      ? (history.working[path]?.after ?? after)
      : after;
  const inFlight = useRef(false);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState<{
    lineIds: number[];
    revision: number;
    headSha: string;
    anchor: DOMRect;
  }>();
  const stale =
    conflict ||
    (confirmation !== undefined &&
      (confirmation.revision !== revision || confirmation.headSha !== headSha));
  const revert = useCallback(async () => {
    if (!confirmation || inFlight.current || done || stale || (history && !history.start())) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(projectChangesApiPath(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          branch,
          path,
          expectedRevision: revision,
          expectedHeadSha: headSha,
          lineIds: confirmation.lineIds,
        }),
      });
      if (response.status === 409) {
        setConflict(true);
        return;
      }
      const result = await response.json().catch(() => null);
      if (!response.ok) throw new Error(result?.error || diffRevertLabels.failure);
      if (result?.undoToken)
        history?.record({
          path,
          token: result.undoToken,
          previousRevision: revision,
          revision: result.revision,
          headSha,
          file: {
            ...(reviewFile ?? {
              path,
              before,
              existed: !!before,
              operation: "modify",
              binary: false,
            }),
            after: result.content ?? before,
          },
          blocks: result.undoBlocks,
        });
      const key = draftKey(projectId, branch, path, ownerId);
      const draft = readDraft(key);
      // Keep recovery copies containing edits that were not part of this comparison.
      if (draft && (draft.text === after || draft.text === result?.content)) clearDraft(key);
      setDone(true);
      setConfirmation(undefined);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : diffRevertLabels.failure);
    } finally {
      inFlight.current = false;
      setPending(false);
      history?.finish();
    }
  }, [
    projectId,
    branch,
    path,
    revision,
    headSha,
    ownerId,
    after,
    router,
    done,
    stale,
    confirmation,
    history,
    before,
    reviewFile,
  ]);
  const requestRevert: DiffRevertHandler = (lineIds, anchor) => {
    if (!inFlight.current && !done && !stale && !history?.pending) {
      const bounds = anchor instanceof HTMLElement ? anchor.getBoundingClientRect() : anchor;
      setConfirmation({
        lineIds: [...lineIds],
        revision,
        headSha,
        anchor: bounds ?? new DOMRect(),
      });
    }
  };
  return (
    <>
      {pending || done ? (
        <p className="sr-only" role="status">
          {pending ? "Откатываем…" : "Фрагмент отменён."}
        </p>
      ) : null}
      {confirmation ? (
        <RevertConfirmation
          anchor={confirmation.anchor}
          title="Откатить выбранные изменения?"
          pending={pending || !!history?.pending}
          stale={stale}
          error={error}
          confirmLabel="Подтвердить откат"
          onCancel={() => {
            setConfirmation(undefined);
            setError("");
          }}
          onConfirm={() => void revert()}
          onRefresh={() => {
            setConfirmation(undefined);
            router.refresh();
          }}
        >
          <p>Остальные изменения сохранятся.</p>
        </RevertConfirmation>
      ) : null}
      <DiffViewer
        path={path}
        before={before}
        after={displayedAfter}
        revertedBlocks={history?.getBlocks(path, displayedAfter)}
        onUndo={history?.undo}
        onRevert={requestRevert}
        revertDisabled={pending || done || stale || !!confirmation || history?.pending}
        lineHref={lineHref}
        revealLine={revealLine}
      />
    </>
  );
}
