"use client";
import { Undo2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { clearDraft, draftKey } from "./draft-storage";

export function RevertFile({
  projectId,
  branch,
  path,
  existed,
  operation,
  revision,
  ownerId,
}: {
  projectId: string;
  branch: string;
  path: string;
  existed: boolean;
  operation: string;
  revision: number;
  ownerId: string;
}) {
  const router = useRouter();
  const [confirmation, setConfirmation] = useState<number>();
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const inFlight = useRef(false);
  const stale = conflict || (confirmation !== undefined && confirmation !== revision);

  async function revert() {
    if (confirmation === undefined || stale || inFlight.current || done) return;
    inFlight.current = true;
    setPending(true);
    setError("");
    try {
      const response = await fetch(`/api/projects/${projectId}/changes`, {
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
      clearDraft(draftKey(projectId, branch, path, ownerId));
      setDone(true);
      setConfirmation(undefined);
      router.refresh();
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось откатить файл.");
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return (
    <>
      <button
        type="button"
        disabled={pending || done}
        onClick={() => {
          setError("");
          setConflict(false);
          setConfirmation(revision);
        }}
      >
        <Undo2 aria-hidden size={14} />
        {done ? "Изменения отменены" : "Откатить изменения"}
      </button>
      {confirmation !== undefined ? (
        <section className="change-revert-confirm" aria-label="Подтверждение отката">
          <p>
            <strong>
              Откатить <code>{path}</code>?
            </strong>
          </p>
          <p>
            {!existed
              ? "Новый файл будет удалён из изменений."
              : operation === "delete"
                ? "Удаление будет отменено. Файл восстановится из Git."
                : "Неотправленные правки будут удалены. Восстановится версия из Git."}
          </p>
          {error ? <p role="alert">{error}</p> : null}
          {stale ? (
            <p role="alert">
              Изменения обновились. Обновите страницу и проверьте файл перед откатом.
            </p>
          ) : null}
          <footer>
            <button type="button" disabled={pending} onClick={() => setConfirmation(undefined)}>
              Отмена
            </button>
            {stale ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmation(undefined);
                  router.refresh();
                }}
              >
                Обновить
              </button>
            ) : (
              <button
                type="button"
                className="pd-button pd-button--danger"
                disabled={pending}
                onClick={() => void revert()}
              >
                {pending ? "Откатываем…" : "Откатить файл"}
              </button>
            )}
          </footer>
        </section>
      ) : null}
    </>
  );
}
