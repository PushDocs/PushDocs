"use client";
import { Redo2 } from "lucide-react";
import type { ReviewRevertedBlock } from "./diff-revert-history";

export function RevertedDiffActions({
  block,
  onUndo,
}: {
  block: ReviewRevertedBlock;
  onUndo?: (id: string) => void;
}) {
  return (
    <div className="wb-reverted-actions">
      <fieldset className="wb-diff-actions" aria-label="Действия с отменённым фрагментом">
        <button
          type="button"
          aria-label="Вернуть изменения"
          title="Вернуть изменения"
          disabled={block.disabled}
          onClick={() => onUndo?.(block.id)}
        >
          <Redo2 size={14} aria-hidden />
        </button>
      </fieldset>
      {block.error ? <p role="alert">{block.error}</p> : null}
    </div>
  );
}
