"use client";
import { Select } from "@pushdocs/ui";
import { useState } from "react";
import { CriticalForm } from "./critical-form";
import { SettingsModal } from "./settings-modal";
export function MemberActions({
  projectId,
  userId,
  name,
  role,
}: {
  projectId: string;
  userId: string;
  name: string;
  role: string;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState(role);
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        className="pd-button pd-button--secondary"
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setSelected(role);
          setOpen(true);
        }}
        aria-label={`Изменить доступ: ${name}`}
      >
        Изменить доступ
      </button>
      {message ? <span role="status">{message}</span> : null}
      {open ? (
        <SettingsModal title={`Доступ: ${name}`} onClose={() => setOpen(false)}>
          <CriticalForm
            kind="manageMember"
            description={`${selected === "remove" ? "Отозвать доступ" : "Изменить роль"}: ${name}`}
            onSuccess={() => {
              setOpen(false);
              setMessage("Доступ обновлён");
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="userId" value={userId} />
            <Select
              name="role"
              label="Доступ к проекту"
              value={selected}
              onValueChange={setSelected}
              options={[
                { value: "admin", label: "Администратор" },
                { value: "editor", label: "Редактор" },
                { value: "reader", label: "Читатель" },
                { value: "remove", label: "Отозвать доступ" },
              ]}
            />
            {selected === "remove" ? (
              <p>Участник потеряет доступ к этому проекту. Его правки и комментарии сохранятся.</p>
            ) : null}
            <button
              className={`pd-button pd-button--${selected === "remove" ? "danger" : "primary"}`}
              type="submit"
            >
              {selected === "remove" ? "Отозвать доступ" : "Сохранить роль"}
            </button>
          </CriticalForm>
        </SettingsModal>
      ) : null}
    </>
  );
}
export { CopyInvitation } from "./copy-invitation";
