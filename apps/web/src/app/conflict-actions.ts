"use server";

import { branchConflictRepositoryKey, branchConflictResolutionSchema } from "@pushdocs/contracts";
import { z } from "zod";
import { providerForConnection } from "@/lib/provider";
import { repository, requireUser } from "@/lib/server";

async function conflictReview(projectId: string, reviewId: string) {
  const user = await requireUser();
  const store = repository();
  await store.requireProjectAccess(user.id, projectId, "project:read");
  const review = (await store.listChangeRequests(projectId, "open")).find(
    (item) => item.id === reviewId,
  );
  if (review?.details?.source?.isFork !== false)
    throw new Error("Исходная ветка PR / MR недоступна для разрешения конфликтов.");
  return { user, store, review };
}

export async function prepareConflictResolutionAction(
  projectId: string,
  reviewId: string,
  currentBranch: string,
) {
  const { store, review } = await conflictReview(projectId, reviewId);
  const branches = [
    ...new Set([review.source_branch, z.string().min(1).max(255).parse(currentBranch)]),
  ];
  return Promise.all(branches.map((branch) => store.getBranchConflictBlockers(projectId, branch)));
}

export async function inspectReviewConflictsAction(
  projectId: string,
  reviewId: string,
  refresh = false,
) {
  const { user, store, review } = await conflictReview(projectId, reviewId);
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
      : { parentSha, sourceSha, repositoryKey: branchConflictRepositoryKey(target) },
  );
}

export async function submitConflictResolutionAction(
  projectId: string,
  inspectionId: string,
  files: unknown,
) {
  const user = await requireUser();
  return repository().queueConflictMerge({
    projectId,
    inspectionId,
    files: branchConflictResolutionSchema.parse(files),
    userId: user.id,
  });
}

export async function retryConflictResolutionAction(projectId: string, jobId: string) {
  const user = await requireUser();
  return repository().retryConflictMerge(projectId, jobId, user.id);
}
