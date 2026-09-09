"use client";
import { Send } from "lucide-react";
import { useState } from "react";
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
  children,
}: {
  projectId: string;
  changeSetId: string;
  branch: string;
  defaultBranch: string;
  disabled: boolean;
  submitting: boolean;
  reviewTitle?: string;
  children?: React.ReactNode;
}) {
  const [createReview, setCreateReview] = useState(true);
  const needsBranch = branch === defaultBranch;
  const [newBranch, setNewBranch] = useState(`docs/update-${changeSetId.slice(0, 8)}`);
  return (
    <form action={submitChangeSetAction} className="submit-panel">
      <h2>{reviewTitle ? "Обновить PR / MR" : "Отправить изменения"}</h2>
      {reviewTitle ? <p>{reviewTitle}</p> : null}
      <input name="projectId" type="hidden" value={projectId} />
      <input name="changeSetId" type="hidden" value={changeSetId} />
      <input name="branch" type="hidden" value={branch} />
      <label>
        {createReview && !reviewTitle
          ? "Название PR / MR и сообщение коммита"
          : "Сообщение коммита"}
        <textarea
          name="message"
          placeholder="Что изменилось?"
          minLength={3}
          maxLength={5000}
          required
          disabled={submitting}
        />
      </label>
      {reviewTitle ? (
        <input type="hidden" name="createReview" value="on" />
      ) : (
        <label className="checkbox-field">
          <input
            name="createReview"
            type="checkbox"
            checked={createReview}
            onChange={(event) => setCreateReview(event.target.checked)}
            disabled={submitting}
          />
          Создать PR / MR в {defaultBranch}
        </label>
      )}
      {needsBranch && createReview ? (
        <label>
          Новая рабочая ветка
          <input
            name="newBranch"
            value={newBranch}
            onChange={(event) => setNewBranch(event.target.value)}
            required
            maxLength={255}
            disabled={submitting}
          />
        </label>
      ) : null}
      <SendButton
        disabled={disabled}
        label={
          reviewTitle
            ? "Отправить в PR / MR"
            : createReview
              ? "Отправить и создать PR / MR"
              : `Отправить в ${branch}`
        }
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
