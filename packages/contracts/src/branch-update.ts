import { z } from "zod";
import {
  type BranchConflictResolution,
  type BranchConflictSnapshot,
  branchConflictLimits,
  hasBranchConflicts,
} from "./branch-conflicts";
import type { ChangeRequestDetails } from "./index";

export enum BranchUpdateStrategy {
  Merge = "merge",
  Rebase = "rebase",
}

export const branchUpdateModes = {
  auto: "auto",
  merge: BranchUpdateStrategy.Merge,
  rebase: BranchUpdateStrategy.Rebase,
} as const;

export enum BranchUpdatePolicySource {
  Repository = "repository",
  Project = "project",
}

export const defaultGitConfig = { updateStrategy: branchUpdateModes.auto } as const;
export const gitConfigSchema = z
  .object({ updateStrategy: z.enum(branchUpdateModes).default(defaultGitConfig.updateStrategy) })
  .strict();

export interface BranchUpdatePolicy {
  strategy: BranchUpdateStrategy | null;
  source: BranchUpdatePolicySource;
  /** Policy is read from the target tree, never from source drafts. */
  targetSha: string;
  configPath: string;
  error?: string;
}

export const branchUpdateMessages = {
  unavailableBranches: "Ветки недоступны для обновления из PushDocs.",
  pendingChanges: "Сначала завершите текущие изменения в исходной ветке.",
  busy: "Ветка уже обновляется. Дождитесь завершения операции.",
  unavailable:
    "Не удалось определить способ обновления ветки. Обновите данные из Git и проверьте настройки проекта.",
  changed:
    "Политика обновления ветки изменилась. Обновите данные из Git и начните операцию заново.",
  rebaseResolution:
    "Для проекта выбран rebase. Запустите обновление ветки, чтобы разрешать конфликты переносимых коммитов.",
} as const;

export function sameBranchUpdatePolicy(
  expected: BranchUpdatePolicy | null | undefined,
  actual: BranchUpdatePolicy | null | undefined,
) {
  return Boolean(
    expected?.strategy &&
      actual?.strategy &&
      !expected.error &&
      !actual.error &&
      expected.strategy === actual.strategy &&
      expected.source === actual.source &&
      expected.targetSha === actual.targetSha &&
      expected.configPath === actual.configPath,
  );
}

export function mergeResolutionPolicyError(policy: BranchUpdatePolicy | null | undefined) {
  if (!policy?.strategy || policy.error) return policy?.error ?? branchUpdateMessages.unavailable;
  return policy.strategy === BranchUpdateStrategy.Rebase
    ? branchUpdateMessages.rebaseResolution
    : null;
}

export function conflictResolutionPolicyError(snapshot: BranchConflictSnapshot) {
  if (!snapshot.rebase) return mergeResolutionPolicyError(snapshot.updatePolicy);
  const policy = snapshot.updatePolicy;
  if (!policy?.strategy || policy.error) return policy?.error ?? branchUpdateMessages.unavailable;
  return policy.strategy === BranchUpdateStrategy.Rebase ? null : branchUpdateMessages.changed;
}

export const branchUpdateLimits = {
  commits: 200,
  version: 1,
  conflictIdChars: 200,
  resolutionBytes: branchConflictLimits.snapshotBytes,
} as const;
export const branchUpdateJobKind = "branch.update";
export const branchUpdateWaitingStatus = "needs_resolution";

// Existing conflict URLs accept review IDs; operation references have their own namespace.
const branchUpdateConflictPrefix = "branch-update:";
export function branchUpdateConflictReference(operationId: string) {
  return `${branchUpdateConflictPrefix}${operationId}`;
}
export function branchUpdateConflictOperationId(reference: string) {
  return reference.startsWith(branchUpdateConflictPrefix)
    ? reference.slice(branchUpdateConflictPrefix.length)
    : undefined;
}

export interface RebaseResolution {
  conflictId: string;
  commitSha: string;
  files: BranchConflictResolution;
}

/** Replayed deterministically from immutable heads; only the current snapshot is retained. */
export interface RebaseProgress {
  version: number;
  branch: string;
  sourceBranch: string;
  parentSha: string;
  sourceSha: string;
  originals: string[];
  commits: PreparedBranchUpdate["commits"];
  resolutions: RebaseResolution[];
}

export interface PreparedBranchUpdate {
  version: number;
  strategy: BranchUpdateStrategy;
  branch: string;
  sourceBranch: string;
  parentSha: string;
  sourceSha: string;
  sha: string;
  commits: Array<{ originalSha: string; sha: string }>;
}

export function branchUpdateStrategy(details: ChangeRequestDetails | null | undefined) {
  return details?.branchUpdatePolicy?.error
    ? null
    : (details?.branchUpdatePolicy?.strategy ?? null);
}

export function needsBranchUpdate(details: ChangeRequestDetails | null | undefined) {
  if (details?.updateRequired != null) return details.updateRequired;
  return (
    details?.readiness?.reason === "need_rebase" ||
    details?.readiness?.reason === "behind" ||
    (branchUpdateStrategy(details) === BranchUpdateStrategy.Rebase &&
      hasBranchConflicts(details?.readiness?.reason))
  );
}
