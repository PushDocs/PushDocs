"use client";

import type { BranchSummary, ProviderKind } from "@pushdocs/contracts";
import { SearchableSelect } from "@pushdocs/ui";
import { GitBranch } from "lucide-react";
import { useEffect, useState } from "react";
import { listLocalDrafts } from "./draft-storage";

const reviewStates = { open: "открыт", merged: "влит", closed: "закрыт" } as const;
const branchListLimits = { maxAgeYears: 1 } as const;
const commitDateFormat = new Intl.DateTimeFormat("ru-RU", {
  dateStyle: "medium",
  timeZone: "UTC",
});

export function SidebarBranchPicker({
  branches,
  defaultBranch,
  onValueChange,
  ownerId,
  projectId,
  provider,
  value,
}: {
  branches: BranchSummary[];
  defaultBranch: string;
  onValueChange: (branch: string) => void;
  ownerId: string;
  projectId: string;
  provider: ProviderKind;
  value: string;
}) {
  const [showCompleted, setShowCompleted] = useState(false);
  const [search, setSearch] = useState("");
  const [localDraftBranches, setLocalDraftBranches] = useState<string[]>([]);
  useEffect(() => {
    const update = () =>
      setLocalDraftBranches(
        listLocalDrafts(
          projectId,
          [value, ...branches.map((branch) => branch.full_ref)],
          ownerId,
        ).map((draft) => draft.branch),
      );
    update();
    window.addEventListener("storage", update);
    window.addEventListener("focus", update);
    return () => {
      window.removeEventListener("storage", update);
      window.removeEventListener("focus", update);
    };
  }, [branches, ownerId, projectId, value]);

  const byName = new Map(branches.map((branch) => [branch.full_ref, branch]));
  const canHide = (branch: BranchSummary) =>
    branch.isCompleted &&
    !branch.is_protected &&
    branch.full_ref !== value &&
    branch.full_ref !== defaultBranch &&
    !localDraftBranches.includes(branch.full_ref);
  const recentSince = new Date();
  recentSince.setUTCFullYear(recentSince.getUTCFullYear() - branchListLimits.maxAgeYears);
  const availableBranches = branches.filter((branch) => {
    const committedAt = Date.parse(branch.lastCommitAt ?? "");
    return search.trim() !== "" || Number.isNaN(committedAt) || committedAt > recentSince.getTime();
  });
  const completedCount = availableBranches.filter(canHide).length;
  const reviewLabel = provider === "gitlab" ? "MR" : "PR";

  return (
    <SearchableSelect
      className="sidebar-branch-picker"
      label="Выбрать текущую ветку"
      leadingIcon={<GitBranch aria-hidden size={16} />}
      value={value}
      fallbackLabel={value}
      options={availableBranches
        .filter((branch) => showCompleted || !canHide(branch))
        .map((branch) => ({ label: branch.full_ref, value: branch.full_ref }))}
      searchLabel="Поиск по веткам"
      searchPlaceholder="Найти ветку…"
      emptyText="Ветки не найдены"
      onSearchChange={setSearch}
      onValueChange={onValueChange}
      renderOption={(option) => {
        const branch = byName.get(option.value);
        const date = branch?.lastCommitAt ? new Date(branch.lastCommitAt) : null;
        const hasDate = date && !Number.isNaN(date.getTime());
        return (
          <span className="branch-option">
            <span className="branch-option-name" title={option.label}>
              {option.label}
            </span>
            <span className="branch-option-meta">
              {hasDate ? (
                <time
                  dateTime={date.toISOString()}
                  title={`Последний коммит: ${date.toISOString()}`}
                >
                  {commitDateFormat.format(date)}
                </time>
              ) : (
                <span>Дата недоступна</span>
              )}
              {branch?.review ? (
                <span
                  className={`branch-review-state branch-review-state--${branch.review.state}`}
                  title={`${reviewLabel} ${provider === "gitlab" ? "!" : "#"}${branch.review.externalId} → ${branch.review.targetBranch}`}
                >
                  {reviewLabel} {reviewStates[branch.review.state]}
                </span>
              ) : null}
            </span>
          </span>
        );
      }}
      footer={
        <>
          <label className="branch-merged-toggle">
            <input
              type="checkbox"
              checked={showCompleted}
              onChange={(event) => setShowCompleted(event.target.checked)}
            />
            Показывать влитые и закрытые{completedCount ? ` (${completedCount})` : ""}
          </label>
          <small className="branch-age-note">Ветки старше года доступны через поиск</small>
        </>
      }
    />
  );
}
