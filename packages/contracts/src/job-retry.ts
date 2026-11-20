import { branchUpdateJobKind } from "./branch-update";

export const jobRetryPolicy = { maxAttempts: 2, delayMs: 30_000 } as const;

/** A continued rebase starts a new retry budget without resetting the durable job counter. */
export function jobAttempt(job: { kind: string; attempts: number; payload: unknown }) {
  const payload = job.payload as { retryBaseAttempt?: unknown } | null;
  const base = job.kind === branchUpdateJobKind ? payload?.retryBaseAttempt : undefined;
  return Math.max(
    0,
    job.attempts - (typeof base === "number" && Number.isSafeInteger(base) && base >= 0 ? base : 0),
  );
}
