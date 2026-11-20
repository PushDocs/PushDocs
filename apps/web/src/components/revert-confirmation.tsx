"use client";

import { AnchoredPopover, Button, type PopoverAnchor } from "@pushdocs/ui";
import type { ReactNode } from "react";

export function RevertConfirmation({
  anchor,
  title,
  children,
  pending,
  stale,
  error,
  confirmLabel,
  onCancel,
  onConfirm,
  onRefresh,
}: {
  anchor: PopoverAnchor;
  title: ReactNode;
  children?: ReactNode;
  pending: boolean;
  stale: boolean;
  error: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
  onRefresh: () => void;
}) {
  return (
    <AnchoredPopover
      anchor={anchor}
      className="change-revert-popover"
      label="Подтверждение отката"
      pending={pending}
      onClose={onCancel}
    >
      <div className="change-revert-confirm">
        <p>
          <strong>{title}</strong>
        </p>
        {children}
        {error ? <p role="alert">{error}</p> : null}
        {stale ? (
          <p role="alert">
            Изменения обновились. Обновите страницу и проверьте изменения перед откатом.
          </p>
        ) : null}
        <footer>
          <Button disabled={pending} onClick={onCancel}>
            Отмена
          </Button>
          {stale ? (
            <Button disabled={pending} onClick={onRefresh}>
              Обновить
            </Button>
          ) : (
            <Button tone="danger" disabled={pending} onClick={onConfirm}>
              {pending ? "Откатываем…" : confirmLabel}
            </Button>
          )}
        </footer>
      </div>
    </AnchoredPopover>
  );
}
