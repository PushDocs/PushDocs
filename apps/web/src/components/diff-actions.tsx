"use client";

import { PencilLine, Undo2 } from "lucide-react";
import Link from "next/link";
import { type DiffRevertHandler, diffRevertLabels } from "./text-diff";

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
  onRevert?: DiffRevertHandler;
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
          onClick={(event) => onRevert(lineIds, event.currentTarget)}
        >
          <Undo2 size={14} aria-hidden />
        </button>
      ) : null}
      {onRevert && !lineIds.length && hunkIds.length ? (
        <button
          type="button"
          title={diffRevertLabels.hunk}
          aria-label={diffRevertLabels.hunk}
          disabled={disabled}
          onClick={(event) => onRevert(hunkIds, event.currentTarget)}
        >
          <Undo2 size={14} aria-hidden />
        </button>
      ) : null}
    </fieldset>
  );
}
