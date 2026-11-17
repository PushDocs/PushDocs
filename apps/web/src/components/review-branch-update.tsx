"use client";

import {
  type BranchUpdateStrategy,
  branchUpdateStrategy,
  branchUpdateWaitingStatus,
  type ChangeRequestDetails,
  hasBranchConflicts,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { GitMerge, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { BranchConflictNotice } from "./branch-conflicts";
import { BranchNotice } from "./branch-notice";
import { listLocalDrafts } from "./draft-storage";
import {
  branchConflictLabels,
  branchSyncLabels,
  branchUpdateLabels,
  pendingBranchChangesLabels,
} from "./git-operation-labels";
import { GitOperationKind } from "./git-operation-store";
import { useGitOperation } from "./use-git-operation";
import { useLocalDraftState } from "./use-local-draft-changes";

export function ReviewBranchUpdate({
  review,
  provider,
  projectId,
  ownerId,
  canWrite,
  activeStrategy,
  activeHeadSha,
  hasPendingChanges = false,
  waitingForResolution = false,
  noticeLabel,
  pendingChangesHref,
  actionOnly = false,
  disableReadOnlyAction = false,
}: {
  projectId: string;
  ownerId: string;
  canWrite: boolean;
  activeStrategy?: BranchUpdateStrategy;
  activeHeadSha?: string;
  hasPendingChanges?: boolean;
  waitingForResolution?: boolean;
  noticeLabel?: string;
  pendingChangesHref?: string;
  actionOnly?: boolean;
  disableReadOnlyAction?: boolean;
  review: {
    id: string;
    head_sha?: string | null;
    source_branch: string;
    target_branch: string;
    provider_url: string;
    details?: ChangeRequestDetails | null;
  };
  provider: "gitlab" | "github";
}) {
  const reviewLabel = provider === "gitlab" ? "MR" : "PR";
  const router = useRouter();
  const [needsResolution, setNeedsResolution] = useState(false);
  const { hasChanges: localChanges, refresh: refreshLocalChanges } = useLocalDraftState(
    projectId,
    ownerId,
    review.source_branch,
  );
  const localChangesHref = `/projects/${projectId}/documents?${new URLSearchParams({ branch: review.source_branch })}`;
  const pendingHref = localChanges ? localChangesHref : pendingChangesHref;
  const strategy = activeStrategy ?? branchUpdateStrategy(review.details);
  const knownConflicts = hasBranchConflicts(review.details?.readiness.reason);
  const headSha = activeHeadSha ?? review.head_sha ?? review.details?.headSha;
  const allowed =
    canWrite &&
    !!strategy &&
    !!headSha &&
    (activeStrategy !== undefined || needsBranchUpdate(review.details)) &&
    (activeStrategy !== undefined || review.details?.source?.isFork === false);
  const { busy, message, error, start, task } = useGitOperation({
    projectId,
    branch: review.source_branch,
    kind: GitOperationKind.UpdateBranch,
    successMessage: () => branchUpdateLabels.success,
    onComplete: () => router.refresh(),
    onNeedsResolution: () => {
      setNeedsResolution(true);
      router.refresh();
    },
  });
  const pendingChanges = !activeStrategy && !busy && (hasPendingChanges || localChanges);
  const policyError = !activeStrategy && (!strategy || !needsBranchUpdate(review.details));
  const statusMessage = pendingChanges
    ? null
    : policyError
      ? branchUpdateLabels.unavailable
      : message
        ? error
          ? branchUpdateLabels.error
          : busy
            ? message
            : branchUpdateLabels.success
        : null;
  async function update() {
    if (!allowed || !headSha || !strategy || busy || pendingChanges) return;
    if (!activeStrategy && listLocalDrafts(projectId, [review.source_branch], ownerId).length) {
      refreshLocalChanges();
      return;
    }
    await start({
      projectId,
      branch: review.source_branch,
      updateReview: { reviewId: review.id, expectedHeadSha: headSha, expectedStrategy: strategy },
    });
  }
  if (waitingForResolution || needsResolution || task?.phase === branchUpdateWaitingStatus)
    return (
      <BranchConflictNotice
        projectId={projectId}
        reviewId={review.id}
        branch={review.source_branch}
        targetBranch={review.target_branch}
        currentBranch={review.source_branch}
        ownerId={ownerId}
        hasPendingChanges={hasPendingChanges}
        canWrite={canWrite}
        providerUrl={review.provider_url}
        reviewLabel={reviewLabel}
        noticeLabel={noticeLabel}
        pendingChangesHref={pendingChangesHref}
        actionOnly={actionOnly}
        disableReadOnlyAction={disableReadOnlyAction}
      />
    );
  return (
    <BranchNotice
      label={noticeLabel ?? "Обновление ветки"}
      className="branch-update-notice"
      actionOnly={actionOnly || !knownConflicts}
      title={
        pendingChanges
          ? pendingBranchChangesLabels.title
          : knownConflicts
            ? branchConflictLabels.noticeTitle
            : branchUpdateLabels.title
      }
      action={
        pendingChanges ? (
          pendingHref ? (
            <Link
              className={actionOnly ? "pd-button pd-button--primary" : undefined}
              href={pendingHref}
            >
              {pendingBranchChangesLabels.action}
            </Link>
          ) : null
        ) : (
          <button
            className="pd-button pd-button--primary"
            type="button"
            disabled={busy || !allowed}
            aria-busy={busy}
            title={
              !canWrite
                ? branchUpdateLabels.reader
                : !allowed
                  ? branchUpdateLabels.unavailableBranch
                  : undefined
            }
            onClick={() => void update()}
          >
            {busy ? (
              <LoaderCircle className="spin" aria-hidden size={15} />
            ) : (
              <GitMerge aria-hidden size={15} />
            )}
            {busy ? branchSyncLabels.busy : branchUpdateLabels.idle}
          </button>
        )
      }
      message={
        statusMessage ? (
          <p role={policyError || error ? "alert" : "status"}>{statusMessage}</p>
        ) : null
      }
    />
  );
}
