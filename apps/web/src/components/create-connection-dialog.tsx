"use client";
import { type ReactNode, useEffect, useId, useRef, useState } from "react";

export function CreateConnectionDialog({ children }: { children: ReactNode }) {
  const titleId = useId();
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    if (open) dialog.current?.showModal();
  }, [open]);
  return (
    <>
      <button type="button" className="pd-button pd-button--primary" onClick={() => setOpen(true)}>
        Создать подключение
      </button>
      {open ? (
        <dialog
          ref={dialog}
          aria-labelledby={titleId}
          className="settings-modal create-connection-dialog"
          onCancel={() => setOpen(false)}
          onClose={() => setOpen(false)}
        >
          <header>
            <h2 id={titleId}>Новое подключение</h2>
            <button type="button" aria-label="Закрыть" onClick={() => setOpen(false)}>
              ×
            </button>
          </header>
          {children}
        </dialog>
      ) : null}
    </>
  );
}
