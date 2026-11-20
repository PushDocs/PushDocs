import {
  BranchUpdateStrategy,
  branchUpdateStrategy,
  hasBranchConflicts,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import type { ComponentProps } from "react";
import { projectChangesHref } from "@/lib/project-paths";
import { BranchConflictNotice } from "./branch-conflicts";
import { ReviewBranchUpdate } from "./review-branch-update";

export function ReviewBranchAction(props: ComponentProps<typeof ReviewBranchUpdate>) {
  const { review, activeStrategy, waitingForResolution = false } = props;
  const conflicts = waitingForResolution || hasBranchConflicts(review.details?.readiness.reason);
  if (!conflicts && !needsBranchUpdate(review.details) && !activeStrategy) return null;
  const pendingChangesHref = projectChangesHref(props.projectId, review.source_branch);
  const noticeLabel = "Состояние ветки";
  if (
    conflicts &&
    !activeStrategy &&
    branchUpdateStrategy(review.details) === BranchUpdateStrategy.Merge
  )
    return (
      <BranchConflictNotice
        projectId={props.projectId}
        reviewId={review.id}
        branch={review.source_branch}
        targetBranch={review.target_branch}
        currentBranch={review.source_branch}
        ownerId={props.ownerId}
        hasPendingChanges={props.hasPendingChanges ?? false}
        canWrite={props.canWrite && review.details?.source?.isFork === false}
        providerUrl={review.provider_url}
        reviewLabel={props.provider === "gitlab" ? "MR" : "PR"}
        pendingChangesHref={pendingChangesHref}
        noticeLabel={noticeLabel}
        actionOnly={props.actionOnly ?? true}
        disableReadOnlyAction
      />
    );
  return (
    <ReviewBranchUpdate
      {...props}
      pendingChangesHref={pendingChangesHref}
      noticeLabel={noticeLabel}
      actionOnly={props.actionOnly ?? true}
      disableReadOnlyAction
    />
  );
}
