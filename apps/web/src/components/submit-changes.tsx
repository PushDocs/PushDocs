"use client";
import { Send } from "lucide-react";
import { useFormStatus } from "react-dom";
import { submitChangeSetAction } from "@/app/actions";

export function SubmitChanges({
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
  const needsBranch = branch === defaultBranch;
  const newBranch = needsBranch ? `docs/update-${changeSetId.slice(0, 8)}` : undefined;
  return (
    <form action={submitChangeSetAction} className="submit-panel">
      <h2>{reviewTitle ? `Обновить ${reviewLabel}` : "Отправить изменения"}</h2>
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
        label={reviewTitle ? `Отправить в ${reviewLabel}` : `Отправить и создать ${reviewLabel}`}
        submitting={submitting}
      />
      {children}
    </form>
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
    <button className="pd-button pd-button--primary" disabled={disabled || pending} type="submit">
      <Send aria-hidden size={16} />
      {pending || submitting ? "Отправляем изменения…" : label}
    </button>
  );
}
