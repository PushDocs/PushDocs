import { expect, it } from "vitest";
import { type BranchReview, branchUpdateMatchesReview, findBranchReview } from "./branch-review";

const merged: BranchReview = {
  external_id: "9",
  source_branch: "docs/task",
  target_branch: "stable",
  state: "merged",
  title: "Update docs",
  provider_url: "https://git.example/9",
};

it("prefers the latest review by number, then an open review for a reused branch", () => {
  const closed = { ...merged, external_id: "10", state: "closed" as const };
  const open = { ...merged, external_id: "8", state: "open" as const };
  expect(findBranchReview([merged, closed], merged.source_branch)).toBe(closed);
  expect(findBranchReview([merged, closed, open], merged.source_branch)).toBe(open);
});

it("excludes other branches and reviews from forks with the same source branch name", () => {
  expect(
    findBranchReview(
      [
        { ...merged, source_branch: "other" },
        { ...merged, source_branch_is_local: false },
        { ...merged, details: { source: { isFork: true } } },
      ],
      merged.source_branch,
    ),
  ).toBeUndefined();
});

it.each([
  [{ externalReviewId: "9" }, true],
  [{ branchOnly: true }, true],
  [{ externalReviewId: "10" }, false],
  [{ sourceBranch: "main", branchOnly: true }, false],
  [{ branch: "other", externalReviewId: "9" }, false],
  [{ branchOnly: true, externalReviewId: "9" }, false],
  [{ branchOnly: true, reviewId: "internal-id" }, false],
  [{}, false],
])("matches a paused update by both branches and review context: %j", (payload, matches) => {
  expect(
    branchUpdateMatchesReview(
      {
        branch: merged.source_branch,
        sourceBranch: merged.target_branch,
        ...payload,
      },
      merged,
    ),
  ).toBe(matches);
});
