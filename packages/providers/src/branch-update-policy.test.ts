import {
  BranchUpdatePolicySource,
  BranchUpdateStrategy,
  branchUpdateMessages,
} from "@pushdocs/contracts";
import { describe, expect, it, vi } from "vitest";
import { loadBranchUpdatePolicy } from "./branch-update-policy";
import { ProviderHttpError } from "./errors";
import { GitHubProvider, GitLabProvider } from "./index";

function fixture(source = JSON.stringify({ version: 1 })) {
  return {
    getRepository: vi
      .fn()
      .mockResolvedValue({ defaultUpdateStrategy: BranchUpdateStrategy.Rebase }),
    readFile: vi.fn().mockResolvedValue(source),
  };
}
const target = { rootPath: "site", targetSha: "target-sha" };

describe("target-branch update policy", () => {
  it("loads an explicit preference from the exact target tree and overrides the repository default", async () => {
    const provider = fixture(JSON.stringify({ version: 1, git: { updateStrategy: "merge" } }));
    expect(await loadBranchUpdatePolicy(provider, "42", target)).toEqual({
      strategy: BranchUpdateStrategy.Merge,
      source: BranchUpdatePolicySource.Project,
      targetSha: "target-sha",
      configPath: "site/.pushdocs/config.json",
    });
    expect(provider.readFile).toHaveBeenCalledExactlyOnceWith(
      "42",
      "target-sha",
      "site/.pushdocs/config.json",
    );
  });

  it("uses repository policy for a missing configuration file", async () => {
    const provider = fixture();
    provider.readFile.mockRejectedValue(new ProviderHttpError(404, "File missing"));
    expect(await loadBranchUpdatePolicy(provider, "42", target)).toMatchObject({
      strategy: BranchUpdateStrategy.Rebase,
      source: BranchUpdatePolicySource.Repository,
    });
  });

  it.each(["{broken", '{"version":2}', '{"version":1,"git":{"updateStrategy":"typo"}}'])(
    "blocks writes for invalid configuration %s",
    async (source) => {
      expect(await loadBranchUpdatePolicy(fixture(source), "42", target)).toMatchObject({
        strategy: null,
        error: branchUpdateMessages.unavailable,
      });
    },
  );

  it.each([
    new ProviderHttpError(403, "Forbidden"),
    new Error("Network error 404 in proxy response"),
  ])("does not mistake inaccessible configuration for a missing file: %s", async (error) => {
    const provider = fixture();
    provider.readFile.mockRejectedValue(error);
    expect(await loadBranchUpdatePolicy(provider, "42", target)).toMatchObject({
      strategy: null,
      error: branchUpdateMessages.unavailable,
    });
  });

  it("requires known repository settings in auto mode, while permitting an explicit preference", async () => {
    const provider = fixture();
    provider.getRepository.mockResolvedValue({ defaultUpdateStrategy: null });
    expect((await loadBranchUpdatePolicy(provider, "42", target)).strategy).toBeNull();
    provider.readFile.mockResolvedValue(
      JSON.stringify({ version: 1, git: { updateStrategy: "merge" } }),
    );
    expect((await loadBranchUpdatePolicy(provider, "42", target)).strategy).toBe(
      BranchUpdateStrategy.Merge,
    );
  });

  it("does not override an inaccessible repository", async () => {
    const provider = fixture(JSON.stringify({ version: 1, git: { updateStrategy: "merge" } }));
    provider.getRepository.mockRejectedValue(new Error("Connection unavailable"));
    expect((await loadBranchUpdatePolicy(provider, "42", target)).strategy).toBeNull();
  });
});

describe("repository defaults", () => {
  it.each([
    ["merge", BranchUpdateStrategy.Merge],
    ["ff", BranchUpdateStrategy.Rebase],
    ["rebase_merge", BranchUpdateStrategy.Rebase],
    ["unknown", null],
  ])("uses GitLab %s as the auto default %s", async (merge_method, strategy) => {
    const provider = new GitLabProvider("https://gitlab.test", "token", async () =>
      Response.json({ merge_method }),
    );
    expect((await provider.getRepository("42")).defaultUpdateStrategy).toBe(strategy);
  });

  it.each([
    [{ allow_merge_commit: true }, BranchUpdateStrategy.Merge],
    [{ allow_merge_commit: false, allow_squash_merge: true }, BranchUpdateStrategy.Merge],
    [
      { allow_merge_commit: false, allow_squash_merge: false, allow_rebase_merge: true },
      BranchUpdateStrategy.Rebase,
    ],
    [{}, null],
  ])("derives the GitHub default from available merge settings %j", async (settings, strategy) => {
    const provider = new GitHubProvider("https://github.com", "token", async () =>
      Response.json(settings),
    );
    expect((await provider.getRepository("acme/docs")).defaultUpdateStrategy).toBe(strategy);
  });
});
