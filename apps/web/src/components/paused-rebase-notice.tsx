"use client";

import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState } from "react";
import { cancelRebaseUpdateAction } from "@/app/conflict-actions";
import { projectChangesHref } from "@/lib/project-paths";
import { BranchNotice } from "./branch-notice";
import { conflictInspectionStore } from "./conflict-inspection";
import { branchConflictLabels, rebaseCancelLabels } from "./git-operation-labels";
import { GitOperationKind, gitOperationKey, gitOperationStore } from "./git-operation-store";

export function PausedRebaseNotice({
  projectId,
  reviewId,
  branch,
  operationId,
  conflictId,
  canResolve,
  canWrite,
}: {
  projectId: string;
  reviewId: string;
  branch: string;
  operationId: string;
  conflictId: string;
  canResolve: boolean;
  canWrite: boolean;
}) {
  const router = useRouter();
  const [error, cancel, pending] = useActionState(async () => {
    if (!canWrite) return "";
    try {
      await cancelRebaseUpdateAction(projectId, operationId, conflictId);
      conflictInspectionStore.invalidate(projectId, reviewId);
      const key = gitOperationKey(projectId, branch, GitOperationKind.UpdateBranch);
      const task = gitOperationStore.getSnapshot(key);
      if (task?.jobId === operationId) gitOperationStore.acknowledge(key, task);
      router.refresh();
      return "";
    } catch (error) {
      return error instanceof Error ? error.message : rebaseCancelLabels.error;
    }
  }, "");

  return (
    <BranchNotice
      label="Приостановленный rebase"
      title={canResolve ? branchConflictLabels.title : "Rebase приостановлен"}
      action={
        <>
          {canResolve && canWrite && !pending ? (
            <Link
              className="pd-button pd-button--primary"
              href={projectChangesHref(projectId, { branch, resolve: reviewId })}
            >
              {branchConflictLabels.action}
            </Link>
          ) : null}
          <form action={cancel}>
            <button
              className="pd-button pd-button--secondary"
              type="submit"
              disabled={!canWrite || pending}
              aria-busy={pending}
            >
              {pending ? <LoaderCircle className="spin" aria-hidden size={15} /> : null}
              {pending ? rebaseCancelLabels.busy : rebaseCancelLabels.idle}
            </button>
          </form>
        </>
      }
      message={
        error ? (
          <p role="alert">{error}</p>
        ) : !canResolve ? (
          <p>Отмените rebase, чтобы продолжить работу с веткой.</p>
        ) : undefined
      }
    />
  );
}
