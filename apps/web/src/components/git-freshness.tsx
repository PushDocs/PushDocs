"use client";

import { Check, GitBranch, RefreshCw } from "lucide-react";
import { branchSyncLabels } from "./git-operation-labels";

export function GitCurrentStatus({ branchCurrent = false }: { branchCurrent?: boolean }) {
  return (
    <span className="git-current-status" role="status">
      <Check size={16} aria-hidden />
      {branchCurrent ? branchSyncLabels.branchCurrent : branchSyncLabels.current}
    </span>
  );
}

export function GitRemoteMissingStatus() {
  return (
    <span className="git-current-status" role="status">
      <GitBranch size={16} aria-hidden />
      {branchSyncLabels.remoteMissing}
    </span>
  );
}

export function GitFreshnessCheck({
  checking,
  disabled = false,
  onCheck,
}: {
  checking: boolean;
  disabled?: boolean;
  onCheck: () => unknown;
}) {
  return (
    <button
      className="pd-button pd-button--secondary git-freshness-check"
      type="button"
      title={branchSyncLabels.check}
      aria-label={branchSyncLabels.check}
      aria-busy={checking}
      disabled={checking || disabled}
      onClick={() => void onCheck()}
    >
      <RefreshCw size={16} className={checking ? "spin" : undefined} aria-hidden />
    </button>
  );
}
