import {
  type BranchUpdatePolicy,
  BranchUpdatePolicySource,
  BranchUpdateStrategy,
  branchUpdateMessages,
  branchUpdateModes,
  projectConfigPaths,
  projectConfigSchema,
} from "@pushdocs/contracts";
import { ProviderHttpError } from "./errors";
import type { GitProvider, ProviderRepository } from "./index";

/** Resolve the project preference independently of the current PR/MR readiness. */
export async function loadBranchUpdatePolicy(
  provider: Pick<GitProvider, "getRepository" | "readFile">,
  repositoryId: string,
  input: {
    rootPath: string;
    targetSha: string;
    repository?: ProviderRepository;
  },
): Promise<BranchUpdatePolicy> {
  const root = input.rootPath === "." ? "" : `${input.rootPath.replace(/^\/+|\/+$/g, "")}/`;
  const policy: BranchUpdatePolicy = {
    targetSha: input.targetSha,
    configPath: `${root}${projectConfigPaths.config}`,
    strategy: null,
    source: BranchUpdatePolicySource.Repository,
  };
  try {
    const [repository, source] = await Promise.all([
      input.repository ?? provider.getRepository(repositoryId),
      provider
        .readFile(repositoryId, input.targetSha, policy.configPath)
        .catch((error: unknown) => {
          if (error instanceof ProviderHttpError && error.status === 404) return null;
          throw error;
        }),
    ]);
    const config = projectConfigSchema.parse(source === null ? { version: 1 } : JSON.parse(source));
    const mode = config.git.updateStrategy;
    policy.source =
      mode === branchUpdateModes.auto
        ? BranchUpdatePolicySource.Repository
        : BranchUpdatePolicySource.Project;
    policy.strategy =
      mode === branchUpdateModes.auto
        ? (repository.defaultUpdateStrategy ?? null)
        : mode === branchUpdateModes.merge
          ? BranchUpdateStrategy.Merge
          : BranchUpdateStrategy.Rebase;
    if (!policy.strategy) policy.error = branchUpdateMessages.unavailable;
  } catch {
    // An unreadable config/settings response must never silently select a writing strategy.
    policy.error = branchUpdateMessages.unavailable;
  }
  return policy;
}
