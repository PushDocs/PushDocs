"use client";
import { Send } from "lucide-react";
import { type ReactNode, useState } from "react";
import { useFormStatus } from "react-dom";
import { SettingsModal, useSettingsModal } from "./settings-modal";

export function SubmitChanges({
  action,
  retryAction,
  projectId,
  changeSetId,
  branch,
  defaultBranch,
  disabled,
  submitting,
  reviewTitle,
  reviewLabel = "PR / MR",
  children,
}: {
  action: (data: FormData) => Promise<void>;
  retryAction?: (data: FormData) => Promise<void>;
  projectId: string;
  changeSetId: string;
  branch: string;
  defaultBranch: string;
  disabled: boolean;
  submitting: boolean;
  reviewTitle?: string;
  reviewLabel?: string;
  children?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const needsBranch = branch === defaultBranch;
  const newBranch = needsBranch ? `docs/update-${changeSetId.slice(0, 8)}` : undefined;
  return (
    <>
      <button
        type="button"
        className="pd-button pd-button--primary"
        disabled={disabled && !submitting}
        onClick={() => setOpen(true)}
      >
        <Send aria-hidden size={16} /> Отправить изменения
      </button>
      {open ? (
        <SettingsModal title="Отправить изменения" onClose={() => setOpen(false)}>
          <SubmissionForm action={action} retryAction={retryAction}>
            {reviewTitle ? <p>{reviewTitle}</p> : null}
            <input name="projectId" type="hidden" value={projectId} />
            <input name="changeSetId" type="hidden" value={changeSetId} />
            <input name="branch" type="hidden" value={branch} />
            <input name="createReview" type="hidden" value="on" />
            {newBranch ? <input name="newBranch" type="hidden" value={newBranch} /> : null}
            <label>
              {!reviewTitle ? `Название ${reviewLabel} и сообщение коммита` : "Сообщение коммита"}
              <textarea
                name="message"
                placeholder="Что изменилось?"
                minLength={3}
                maxLength={5000}
                required
                disabled={submitting}
              />
            </label>
            <SendButton
              disabled={disabled}
              label={
                reviewTitle ? `Отправить в ${reviewLabel}` : `Отправить и создать ${reviewLabel}`
              }
              submitting={submitting}
            />
            {children}
          </SubmissionForm>
        </SettingsModal>
      ) : null}
    </>
  );
}
function SendButton({
  disabled,
  label,
  submitting,
}: {
  disabled: boolean;
  label: string;
  submitting: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      className="pd-button pd-button--primary"
      disabled={disabled || pending || submitting}
      type="submit"
    >
      <Send aria-hidden size={16} />
      {pending || submitting ? "Отправляем изменения…" : label}
    </button>
  );
}

function SubmissionForm({
  action,
  retryAction,
  children,
}: {
  action: (data: FormData) => Promise<void>;
  retryAction?: (data: FormData) => Promise<void>;
  children: ReactNode;
}) {
  const modal = useSettingsModal();
  const run = async (handler: (data: FormData) => Promise<void>, data: FormData) => {
    try {
      await handler(data);
      modal.saved();
    } finally {
      modal.setPending(false);
    }
  };
  return (
    <form
      className="submit-form"
      onSubmit={() => modal.setPending(true)}
      action={(data) => run(action, data)}
    >
      {children}
      {retryAction ? (
        <button
          className="pd-button"
          type="submit"
          formAction={(data) => run(retryAction, data)}
          formNoValidate
          disabled={modal.pending}
        >
          Проверить результат и повторить
        </button>
      ) : null}
    </form>
  );
}
