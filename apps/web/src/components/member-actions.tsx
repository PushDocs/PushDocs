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
  const [revoking, setRevoking] = useState(false);
  const [message, setMessage] = useState("");
  return (
    <>
      <button
        className="pd-button pd-button--secondary"
        type="button"
        onClick={(event) => {
          event.currentTarget.focus();
          setSelected(role);
          setRevoking(false);
          setOpen(true);
        }}
        aria-label={`Изменить доступ: ${name}`}
      >
        Изменить доступ
      </button>
      {message ? <span role="status">{message}</span> : null}
      {open ? (
        <SettingsModal
          title={`Доступ: ${name}`}
          onClose={() => setOpen(false)}
          confirmDiscard={false}
        >
          <CriticalForm
            key={revoking ? "revoke" : "role"}
            kind="manageMember"
            description={`${revoking ? "Отозвать доступ" : "Изменить роль"}: ${name}`}
            onSuccess={() => {
              setOpen(false);
              setMessage(revoking ? "Доступ отозван" : "Доступ обновлён");
            }}
          >
            <input type="hidden" name="projectId" value={projectId} />
            <input type="hidden" name="userId" value={userId} />
            {revoking ? (
              <>
                <input type="hidden" name="role" value="remove" />
                <h3>Отозвать доступ у {name}?</h3>
                <p>
                  Участник потеряет доступ к этому проекту. Его правки и комментарии сохранятся.
                </p>
                <div className="settings-modal-actions">
                  <button
                    className="pd-button pd-button--secondary"
                    type="button"
                    onClick={() => setRevoking(false)}
                  >
                    Отмена
                  </button>
                  <button className="pd-button pd-button--danger" type="submit">
                    Подтвердить отзыв доступа
                  </button>
                </div>
              </>
            ) : (
              <>
                <Select
                  name="role"
                  label="Доступ к проекту"
                  value={selected}
                  onValueChange={setSelected}
                  options={[
                    { value: "admin", label: "Администратор" },
                    { value: "editor", label: "Редактор" },
                    { value: "reader", label: "Читатель" },
                  ]}
                />
                <div className="settings-modal-actions">
                  <button className="pd-button pd-button--primary" type="submit">
                    Сохранить роль
                  </button>
                  <button
                    className="pd-button pd-button--danger"
                    type="button"
                    onClick={() => setRevoking(true)}
                  >
                    Отозвать доступ
                  </button>
                </div>
              </>
            )}
          </CriticalForm>
        </SettingsModal>
      ) : null}
    </>
  );
}
export { CopyInvitation } from "./copy-invitation";
