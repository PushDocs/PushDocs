import type { ChangeRequestDetails } from "./index";

export enum BranchUpdateStrategy {
  Merge = "merge",
  Rebase = "rebase",
}

export const branchUpdateLimits = { commits: 200, version: 1 } as const;
export const branchUpdateJobKind = "branch.update";

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
  if (details?.requiredUpdateStrategy === BranchUpdateStrategy.Rebase)
    return BranchUpdateStrategy.Rebase;
  if (details?.readiness?.state !== "blocked") return null;
  if (details.readiness.reason === "need_rebase") return BranchUpdateStrategy.Rebase;
  if (details.readiness.reason === "behind") return BranchUpdateStrategy.Merge;
  return null;
}

export function needsBranchUpdate(details: ChangeRequestDetails | null | undefined) {
  return branchUpdateStrategy(details) !== null;
}
