import { describe, expect, it } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../tests/fixtures/branch-update-policy";
import {
  BranchUpdateStrategy,
  branchUpdateModes,
  branchUpdateStrategy,
  type ChangeRequestDetails,
  needsBranchUpdate,
  projectConfigSchema,
} from "./index";

describe("branch update requirement and policy", () => {
  it.each(["conflict", "dirty"])(
    "updates a conflicted rebase branch before opening the editor: %s",
    (reason) => {
      const details = {
        readiness: { state: "blocked", reason },
        branchUpdatePolicy: resolvedBranchUpdatePolicy({ strategy: BranchUpdateStrategy.Rebase }),
      } as ChangeRequestDetails;
      expect(needsBranchUpdate(details)).toBe(true);
      expect(needsBranchUpdate({ ...details, updateRequired: false })).toBe(false);
      expect(
        needsBranchUpdate({ ...details, branchUpdatePolicy: resolvedBranchUpdatePolicy() }),
      ).toBe(false);
    },
  );

  it.each(["need_rebase", "behind", "conflict", "draft_status", null])(
    "keeps the selected merge strategy when readiness becomes %s",
    (reason) => {
      const details = {
        readiness: { state: "blocked", reason },
        branchUpdatePolicy: resolvedBranchUpdatePolicy(),
      } as ChangeRequestDetails;
      expect(branchUpdateStrategy(details)).toBe(BranchUpdateStrategy.Merge);
    },
  );

  it("retains a masked update requirement without inventing an unavailable policy", () => {
    const details = {
      updateRequired: true,
      readiness: { state: "blocked", reason: "draft_status" },
    } as ChangeRequestDetails;
    expect(needsBranchUpdate(details)).toBe(true);
    expect(branchUpdateStrategy(details)).toBeNull();
  });

  it("does not request an update merely because a strategy is configured", () => {
    const details = {
      updateRequired: false,
      readiness: { state: "ready", reason: null },
      branchUpdatePolicy: resolvedBranchUpdatePolicy({ strategy: BranchUpdateStrategy.Rebase }),
    } as ChangeRequestDetails;
    expect(needsBranchUpdate(details)).toBe(false);
    expect(branchUpdateStrategy(details)).toBe(BranchUpdateStrategy.Rebase);
  });

  it("requires refreshed policy for legacy cached review status", () => {
    const details = {
      readiness: { state: "blocked", reason: "need_rebase" },
    } as ChangeRequestDetails;
    expect(needsBranchUpdate(details)).toBe(true);
    expect(branchUpdateStrategy(details)).toBeNull();
  });
});

describe("project Git configuration", () => {
  it("defaults to repository policy", () => {
    expect(projectConfigSchema.parse({ version: 1 }).git.updateStrategy).toBe(
      branchUpdateModes.auto,
    );
  });

  it.each(Object.values(branchUpdateModes))("accepts %s", (updateStrategy) => {
    expect(
      projectConfigSchema.parse({ version: 1, git: { updateStrategy } }).git.updateStrategy,
    ).toBe(updateStrategy);
  });

  it.each([{ updateStrategy: "squash" }, { updateStrategy: "merge", squash: true }])(
    "rejects unsupported Git configuration %j",
    (git) => expect(projectConfigSchema.safeParse({ version: 1, git }).success).toBe(false),
  );
});
