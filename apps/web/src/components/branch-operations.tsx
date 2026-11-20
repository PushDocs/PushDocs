"use client";

import { Check, CircleAlert, Download, GitMerge, LoaderCircle, X } from "lucide-react";
import { branchSyncLabels } from "./git-operation-labels";
import { GitOperationKind } from "./git-operation-store";
import { useGitOperation } from "./use-git-operation";

export function BranchOperations({
  projectId,
  branch,
  defaultBranch,
  canMerge,
  disabled,
  beforeStart,
  onComplete,
  onBusyChange,
}: {
  projectId: string;
  branch: string;
  defaultBranch?: string;
  canMerge: boolean;
  disabled: boolean;
  beforeStart: () => Promise<boolean>;
  onComplete: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const { busy, task, message, error, start, dismiss } = useGitOperation({
    projectId,
    branch,
    kind: GitOperationKind.Pull,
    onComplete,
    onBusyChange,
    successMessage: (kind) =>
      kind === GitOperationKind.Merge
        ? `${defaultBranch} влита в ${branch}`
        : `Ветка ${branch} обновлена из Git`,
  });
  function startOperation(merge: boolean) {
    return start(
      { projectId, branch, ...(merge ? { mergeDefault: true } : {}) },
      merge ? GitOperationKind.Merge : GitOperationKind.Pull,
      beforeStart,
    );
  }

  return (
    <div className="wb-branch-operations">
      <button
        type="button"
        className="pd-button pd-button--secondary"
        disabled={busy || disabled}
        aria-busy={busy}
        title={message || `Получить свежую версию ${branch} из Git в PushDocs`}
        onClick={() => void startOperation(false)}
      >
        {busy ? (
          <LoaderCircle className="spin" size={16} aria-hidden />
        ) : (
          <Download size={16} aria-hidden />
        )}
        <span className="git-operation-label">
          <span aria-hidden={busy}>{branchSyncLabels.idle}</span>
          <span aria-hidden={!busy}>{branchSyncLabels.busy}</span>
        </span>
      </button>
      {canMerge && defaultBranch && branch !== defaultBranch ? (
        <details className="wb-disclosure wb-merge-menu">
          <summary aria-label={`Влить ${defaultBranch} в ${branch}`}>
            <GitMerge size={16} aria-hidden /> Влить {defaultBranch}…
          </summary>
          <div className="wb-popover">
            <p>
              Свежие изменения {defaultBranch} будут влиты в {branch} и сразу отправлены в Git.
              Открытый PR / MR обновится автоматически и останется открытым. PR / MR не требуется
              для этой операции. Черновики останутся в PushDocs.
            </p>
            <button
              type="button"
              className="pd-button pd-button--secondary"
              disabled={busy || disabled}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void startOperation(true);
              }}
            >
              Влить в {branch}
            </button>
          </div>
        </details>
      ) : null}
      {busy ? (
        <span className="sr-only" role="status">
          {message ||
            (task?.kind === GitOperationKind.Merge
              ? `Вливаем ${defaultBranch} в ${branch}…`
              : `Обновляем ${branch}…`)}
        </span>
      ) : message ? (
        <div
          className={`settings-notification settings-notification--${error ? "error" : "success"} wb-git-notification`}
          role={error ? "alert" : "status"}
        >
          {error ? <CircleAlert size={18} aria-hidden /> : <Check size={18} aria-hidden />}
          <p>{message}</p>
          <button type="button" aria-label="Закрыть уведомление" onClick={dismiss}>
            <X size={16} aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
