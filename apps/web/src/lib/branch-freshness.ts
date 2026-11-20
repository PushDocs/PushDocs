export interface BranchFreshness {
  remoteSha: string | null;
  defaultBranch: string;
  defaultHeadSha: string | null;
  includesDefaultBranch: boolean | null;
}
