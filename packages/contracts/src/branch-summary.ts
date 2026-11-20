export interface BranchReviewSummary {
  externalId: string;
  state: "open" | "merged" | "closed";
  targetBranch: string;
}

export interface BranchSummary {
  full_ref: string;
  is_protected?: boolean;
  lastCommitAt?: string | null;
  review?: BranchReviewSummary | null;
  /** The review is closed or the latest known Git head was merged, with no pending local work. */
  isCompleted?: boolean;
}
