"use server";

import {
  branchConflictRepositoryKey,
  branchConflictResolutionSchema,
  branchUpdateConflictOperationId,
  branchUpdateLimits,
  branchUpdateWaitingStatus,
} from "@pushdocs/contracts";
import { loadBranchUpdatePolicy } from "@pushdocs/providers";
import { z } from "zod";
import { providerForConnection } from "@/lib/provider";
import { repository, requireUser } from "@/lib/server";

async function conflictContext(projectId: string, reference: string) {
  const user = await requireUser();
  const store = repository();
  await store.requireProjectAccess(user.id, projectId, "project:read");
  const operationId = branchUpdateConflictOperationId(reference);
  if (operationId !== undefined) {
    const operation = await store.getBranchUpdateOperation(
      projectId,
      z.string().uuid().parse(operationId),
    );
    const payload = operation?.payload as { branch?: string; sourceBranch?: string } | undefined;
    if (!operation || !payload?.branch || !payload.sourceBranch)
      throw new Error("Операция обновления ветки недоступна.");
    return {
      user,
      store,
      operation,
      review: undefined,
      branch: payload.branch,
      sourceBranch: payload.sourceBranch,
    };
  }
  const review = (await store.listChangeRequests(projectId, "open")).find(
    (item) => item.id === reference,
  );
  if (review?.details?.source?.isFork !== false)
    throw new Error("Исходная ветка PR / MR недоступна для разрешения конфликтов.");
  return {
    user,
    store,
    review,
    operation: undefined,
    branch: review.source_branch,
    sourceBranch: review.target_branch,
  };
}

export async function prepareConflictResolutionAction(
  projectId: string,
  reviewId: string,
  currentBranch: string,
) {
  const { store, branch } = await conflictContext(projectId, reviewId);
  const branches = [...new Set([branch, z.string().min(1).max(255).parse(currentBranch)])];
  return Promise.all(branches.map((branch) => store.getBranchConflictBlockers(projectId, branch)));
}

export async function inspectReviewConflictsAction(
  projectId: string,
  reviewId: string,
  refresh = false,
) {
  const context = await conflictContext(projectId, reviewId);
  const { user, store, review } = context;
  if (context.operation) {
    if ([branchUpdateWaitingStatus, "queued", "running"].includes(context.operation.status))
      return context.operation.id;
    throw new Error("Операция больше не ожидает разрешения конфликтов. Обновите страницу.");
  }
  if (!review) throw new Error("PR / MR недоступен");
  const active = await store.getActiveReviewBranchUpdate(projectId, review.source_branch);
  if (active?.status === branchUpdateWaitingStatus) return active.id;
  const target = await store.getProjectSyncTarget(projectId);
  if (!target) throw new Error("Подключение проекта недоступно");
  const provider = await providerForConnection(target);
  const branches = await provider.listBranches(target.provider_repository_id);
  const parentSha = branches.find((item) => item.name === review.source_branch)?.sha;
  const sourceSha = branches.find((item) => item.name === review.target_branch)?.sha;
  if (!parentSha || !sourceSha) throw new Error("Ветка PR / MR недоступна");
  return store.enqueueConflictInspection(
    {
      projectId,
      reviewId,
      externalReviewId: review.external_id,
      branch: review.source_branch,
      sourceBranch: review.target_branch,
      userId: user.id,
      refresh,
    },
    refresh
      ? undefined
      : {
          parentSha,
          sourceSha,
          repositoryKey: branchConflictRepositoryKey(target),
          updatePolicy: await loadBranchUpdatePolicy(provider, target.provider_repository_id, {
            rootPath: target.root_path,
            targetSha: sourceSha,
          }),
        },
  );
}

export async function submitConflictResolutionAction(
  projectId: string,
  inspectionId: string,
  files: unknown,
  conflictId?: string,
  mergeConflictId?: string,
) {
  const user = await requireUser();
  if (mergeConflictId)
    return repository().continueMergeUpdate({
      projectId,
      operationId: inspectionId,
      conflictId: z.string().min(1).max(branchUpdateLimits.conflictIdChars).parse(mergeConflictId),
      files: branchConflictResolutionSchema.parse(files),
      userId: user.id,
    });
  if (conflictId)
    return repository().continueRebaseUpdate({
      projectId,
      operationId: inspectionId,
      conflictId: z.string().min(1).max(branchUpdateLimits.conflictIdChars).parse(conflictId),
      files: branchConflictResolutionSchema.parse(files),
      userId: user.id,
    });
  return repository().queueConflictMerge({
    projectId,
    inspectionId,
    files: branchConflictResolutionSchema.parse(files),
    userId: user.id,
  });
}

export async function cancelRebaseUpdateAction(
  projectId: string,
  operationId: string,
  conflictId: string,
) {
  const user = await requireUser();
  await repository().cancelRebaseUpdate(
    projectId,
    operationId,
    z.string().min(1).max(branchUpdateLimits.conflictIdChars).parse(conflictId),
    user.id,
  );
}

export async function retryConflictResolutionAction(projectId: string, jobId: string) {
  const user = await requireUser();
  const job = await repository().getProjectJob(projectId, jobId);
  if (job?.branchUpdateOperation)
    return repository().retryReviewBranchUpdate(projectId, jobId, user.id);
  return repository().retryConflictMerge(projectId, jobId, user.id);
}
