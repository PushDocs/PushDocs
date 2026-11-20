import {
  type BranchUpdatePolicy,
  BranchUpdatePolicySource,
  BranchUpdateStrategy,
  projectConfigPaths,
} from "@pushdocs/contracts";

export function resolvedBranchUpdatePolicy(
  overrides: Partial<BranchUpdatePolicy> = {},
): BranchUpdatePolicy {
  return {
    strategy: BranchUpdateStrategy.Merge,
    source: BranchUpdatePolicySource.Repository,
    targetSha: "target",
    configPath: projectConfigPaths.config,
    ...overrides,
  };
}
