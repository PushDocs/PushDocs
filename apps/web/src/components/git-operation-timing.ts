import { branchConflictLimits } from "@pushdocs/contracts";

export const gitOperationPollingDelays = { normal: 2000, retry: 5000 } as const;
export const branchConflictPollingDelays = {
  normal: branchConflictLimits.pollMs,
  retry: branchConflictLimits.pollMs,
} as const;
