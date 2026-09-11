"use client";
import { type ReactNode, useState } from "react";
import { SettingsModal } from "./settings-modal";
export function CreateConnectionDialog({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="pd-button pd-button--primary"
        onClick={(event) => {
          event.currentTarget.focus();
          setOpen(true);
        }}
      >
        Создать подключение
      </button>
      {open ? (
        <SettingsModal title="Новое подключение" onClose={() => setOpen(false)}>
          {children}
        </SettingsModal>
      ) : null}
    </>
  );
}
