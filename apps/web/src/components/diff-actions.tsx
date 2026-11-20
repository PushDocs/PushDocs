"use client";

import { PencilLine, RotateCcw, Undo2 } from "lucide-react";
import Link from "next/link";
import { diffRevertLabels } from "./text-diff";

export function DiffActions({
  lineIds,
  hunkIds,
  editHref,
  onRevert,
  disabled,
}: {
  lineIds: number[];
  hunkIds: number[];
  editHref?: string;
  onRevert?: (ids: number[]) => void;
  disabled?: boolean;
}) {
  return (
    <fieldset className="wb-diff-actions" aria-label="Действия со строкой">
      {editHref ? (
        <Link
          href={editHref}
          title="Открыть строку в редакторе"
          aria-label="Открыть строку в редакторе"
        >
          <PencilLine size={14} aria-hidden />
        </Link>
      ) : null}
      {onRevert && lineIds.length ? (
        <button
          type="button"
          title={diffRevertLabels.line}
          aria-label={diffRevertLabels.line}
          disabled={disabled}
          onClick={() => onRevert(lineIds)}
        >
          <Undo2 size={14} aria-hidden />
        </button>
      ) : null}
      {onRevert && hunkIds.length > lineIds.length ? (
        <button
          type="button"
          title={diffRevertLabels.hunk}
          aria-label={diffRevertLabels.hunk}
          disabled={disabled}
          onClick={() => onRevert(hunkIds)}
        >
          <RotateCcw size={14} aria-hidden />
        </button>
      ) : null}
    </fieldset>
  );
}
