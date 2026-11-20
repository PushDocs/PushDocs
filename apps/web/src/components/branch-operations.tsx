"use client";

import { Check, CircleAlert, Download, GitMerge, LoaderCircle, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { GitCurrentStatus, GitFreshnessCheck, GitRemoteMissingStatus } from "./git-freshness";
import { branchSyncLabels, branchUpdateLabels } from "./git-operation-labels";
import { GitOperationKind } from "./git-operation-store";
import { useBranchFreshness } from "./use-branch-freshness";
import { useGitOperation } from "./use-git-operation";

export function BranchOperations({
  projectId,
  branch,
  headSha,
  remoteHeadSha,
  defaultBranch,
  canMerge,
  disabled,
  beforeStart,
  onComplete,
  onBusyChange,
}: {
  projectId: string;
  branch: string;
  headSha?: string;
  remoteHeadSha?: string | null;
  defaultBranch?: string;
  canMerge: boolean;
  disabled: boolean;
  beforeStart: () => Promise<boolean>;
  onComplete: () => Promise<unknown>;
  onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [needsResolution, setNeedsResolution] = useState(false);
  const { busy, task, message, error, start, dismiss } = useGitOperation({
    projectId,
    branch,
    kind: GitOperationKind.Pull,
    onComplete,
    onBusyChange,
    onNeedsResolution: async () => {
      setNeedsResolution(true);
      await onComplete();
      router.refresh();
    },
    successMessage: (kind) =>
      kind === GitOperationKind.Merge
        ? `Ветка ${branch} обновлена из ${defaultBranch}`
        : `Ветка ${branch} обновлена из Git`,
  });
  const freshness = useBranchFreshness({
    projectId,
    branch,
    headSha,
    remoteHeadSha,
    defaultBranch,
  });
  const sourceBranch = defaultBranch ?? freshness.defaultBranch;
  const includesDefault =
    sourceBranch && branch !== sourceBranch ? freshness.includesDefaultBranch : true;
  const unknown =
    !freshness.remoteMissing && (freshness.filesCurrent === null || includesDefault === null);
  const showBranchUpdate =
    includesDefault === false || (busy && task?.kind === GitOperationKind.Merge);
  function startOperation(merge: boolean) {
    if (busy || disabled) return;
    if (merge ? includesDefault !== false : freshness.filesCurrent !== false) return;
    setNeedsResolution(false);
    return start(
      { projectId, branch, ...(merge ? { mergeDefault: true } : {}) },
      merge ? GitOperationKind.Merge : GitOperationKind.Pull,
      beforeStart,
    );
  }

  return (
    <div className="wb-branch-operations">
      {!busy && freshness.remoteMissing ? <GitRemoteMissingStatus /> : null}
      {!busy && freshness.filesCurrent === true && includesDefault === true ? (
        <GitCurrentStatus branchCurrent={!!sourceBranch} />
      ) : null}
      {!busy && unknown ? (
        <GitFreshnessCheck
          checking={freshness.checking}
          disabled={disabled}
          onCheck={freshness.refresh}
        />
      ) : null}
      {busy || freshness.filesCurrent === false ? (
        <button
          type="button"
          className="pd-button pd-button--secondary"
          disabled={busy || disabled}
          aria-busy={busy}
          title={message || branchSyncLabels.description}
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
      ) : null}
      {canMerge && sourceBranch && branch !== sourceBranch && showBranchUpdate ? (
        <details className="wb-disclosure wb-merge-menu">
          <summary aria-label={`Обновить ${branch} из ${sourceBranch}`}>
            <GitMerge size={16} aria-hidden /> {branchUpdateLabels.idle}…
          </summary>
          <div className="wb-popover">
            <p>Добавит изменения из {sourceBranch} и отправит ветку в Git.</p>
            <button
              type="button"
              className="pd-button pd-button--secondary"
              disabled={busy || disabled}
              onClick={(event) => {
                event.currentTarget.closest("details")?.removeAttribute("open");
                void startOperation(true);
              }}
            >
              {branchUpdateLabels.idle}
            </button>
          </div>
        </details>
      ) : null}
      {!busy && freshness.filesCurrent === true && includesDefault === false && !canMerge ? (
        <span className="git-current-status">Есть изменения в {sourceBranch}</span>
      ) : null}
      {busy ? (
        <span className="sr-only" role="status">
          {message ||
            (task?.kind === GitOperationKind.Merge
              ? `Вливаем ${defaultBranch} в ${branch}…`
              : `Обновляем ${branch}…`)}
        </span>
      ) : message && !needsResolution ? (
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
