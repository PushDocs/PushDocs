export interface BranchReview {
  external_id: string;
  source_branch: string;
  target_branch: string;
  state: "open" | "merged" | "closed";
  title: string;
  provider_url: string;
  source_branch_is_local?: boolean | null;
  details?: { source?: { isFork?: boolean } | null } | null;
}

export function findBranchReview<T extends BranchReview>(reviews: T[], branch: string) {
  return reviews
    .filter(
      (review) =>
        review.source_branch === branch &&
        review.source_branch_is_local !== false &&
        review.details?.source?.isFork !== true,
    )
    .sort(
      (a, b) =>
        Number(b.state === "open") - Number(a.state === "open") ||
        b.external_id.localeCompare(a.external_id, undefined, { numeric: true }),
    )[0];
}
