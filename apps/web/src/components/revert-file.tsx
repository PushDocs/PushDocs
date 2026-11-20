"use client";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { projectChangesApiPath } from "@/lib/project-paths";
import type { ReviewFile } from "./change-review";
import { useDiffRevertHistory } from "./diff-revert-history";
import { clearDraft, draftKey } from "./draft-storage";
import { RevertConfirmation } from "./revert-confirmation";

export function RevertFile({
  projectId,
  branch,
  path,
  existed,
  operation,
  revision,
  ownerId,
  reviewFile,
}: {
  projectId: string;
  branch: string;
  path: string;
  existed: boolean;
  operation: string;
  revision: number;
  ownerId: string;
  reviewFile?: ReviewFile;
}) {
  const router = useRouter();
  const history = useDiffRevertHistory();
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState<number>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const stale = conflict || (confirmation !== undefined && confirmation !== revision);

  async function revert() {
    /* v8 ignore next -- confirmation controls are hidden or disabled for every guarded state. */
    if (
      confirmation === undefined ||
      stale ||
      inFlight.current ||
      done ||
      (history && !history.start())
    )
      return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(projectChangesApiPath(projectId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ branch, path, expectedRevision: confirmation }),
      });
      if (!response.ok) {
        if (response.status === 409) {
          setConflict(true);
          return;
        }
        const result = await response.json().catch(() => null);
        throw new Error(result?.error || "Не удалось откатить файл. Повторите попытку.");
      }
      const result = await response.json().catch(() => null);
      if (result?.undoToken)
        history?.record({
          path,
          token: result.undoToken,
          headSha: result.undoHeadSha,
          previousRevision: confirmation,
          revision: result.revision,
          file: {
            ...(reviewFile ?? { path, before: "", existed, operation, binary: false }),
            after: result.content ?? reviewFile?.before ?? "",
          },
          blocks: result.undoBlocks,
        });
      clearDraft(draftKey(projectId, branch, path, ownerId));
      setDone(true);
      setConfirmation(undefined);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось откатить файл.");
    } finally {
      inFlight.current = false;
      setPending(false);
      history?.finish();
    }
  }
  return (
    <>
      <button
        type="button"
        ref={trigger}
        disabled={pending || done || history?.pending}
        onClick={() => {
          setError("");
          setConflict(false);
          setConfirmation(revision);
        }}
      >
        <Undo2 aria-hidden size={14} />
        {done ? "Изменения отменены" : "Откатить изменения"}
      </button>
      {confirmation !== undefined && trigger.current ? (
        <RevertConfirmation
          anchor={trigger.current}
          title="Откатить весь файл?"
          pending={pending || !!history?.pending}
          stale={stale}
          error={error}
          confirmLabel="Откатить файл"
          onCancel={() => setConfirmation(undefined)}
          onConfirm={() => void revert()}
          onRefresh={() => {
            setConfirmation(undefined);
            router.refresh();
          }}
        >
          {!existed ? (
            <p>Новый файл будет удалён из изменений.</p>
          ) : operation === "delete" ? (
            <p>Удаление будет отменено. Файл восстановится из Git.</p>
          ) : null}
        </RevertConfirmation>
      ) : null}
    </>
  );
}
