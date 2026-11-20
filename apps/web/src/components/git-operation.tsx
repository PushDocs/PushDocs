"use client";
import { Download, GitPullRequest, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { GitCurrentStatus, GitFreshnessCheck, GitRemoteMissingStatus } from "./git-freshness";
import { branchSyncLabels } from "./git-operation-labels";
import { GitOperationKind } from "./git-operation-store";
import { ReviewDescription } from "./review-description";
import { useBranchFreshness } from "./use-branch-freshness";
import { useGitOperation } from "./use-git-operation";

export function GitOperation({
  projectId,
  branch,
  headSha,
  remoteHeadSha,
  defaultBranch,
  reviewsOnly = false,
  createReview = false,
  reviewLabel = "PR / MR",
  disabled = false,
  children,
}: {
  reviewsOnly?: boolean;
  projectId: string;
  branch: string;
  headSha?: string;
  remoteHeadSha?: string | null;
  defaultBranch?: string;
  createReview?: boolean;
  reviewLabel?: string;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const { busy, message, error, start } = useGitOperation({
    projectId,
    branch,
    kind: reviewsOnly
      ? GitOperationKind.Reviews
      : createReview
        ? GitOperationKind.CreateReview
        : GitOperationKind.Pull,
    onComplete: () => router.refresh(),
    successMessage: (kind) =>
      kind === GitOperationKind.CreateReview
        ? `${reviewLabel} создан`
        : kind === GitOperationKind.Reviews
          ? `Состояние ${reviewLabel} обновлено`
          : `Ветка ${branch} обновлена из Git`,
  });
  const freshness = useBranchFreshness({
    projectId,
    branch,
    headSha,
    remoteHeadSha,
    defaultBranch,
    enabled: !reviewsOnly && !createReview,
  });
  const upToDate = freshness.filesCurrent === true;
  const isPull = !reviewsOnly && !createReview;
  const idleLabel = createReview
    ? `Создать ${reviewLabel}`
    : reviewsOnly
      ? `Обновить данные ${reviewLabel}`
      : branchSyncLabels.idle;
  const busyLabel = createReview
    ? `Создаём ${reviewLabel}…`
    : reviewsOnly
      ? `Обновляем ${reviewLabel}…`
      : branchSyncLabels.busy;
  const submitButton = (
    <button
      className={`pd-button pd-button--${createReview ? "primary" : "secondary"}`}
      type="submit"
      disabled={busy || disabled || upToDate}
      aria-busy={busy}
      title={
        createReview
          ? undefined
          : reviewsOnly
            ? `Обновить статусы, проверки и обсуждения ${reviewLabel} из Git`
            : upToDate
              ? branchSyncLabels.current
              : branchSyncLabels.description
      }
    >
      {busy ? (
        <LoaderCircle className="spin" aria-hidden size={16} />
      ) : createReview ? (
        <GitPullRequest aria-hidden size={16} />
      ) : (
        <Download aria-hidden size={16} />
      )}
      <span className="git-operation-label">
        <span aria-hidden={busy}>{idleLabel}</span>
        <span aria-hidden={!busy}>{busyLabel}</span>
      </span>
    </button>
  );
  return (
    <form
      className="git-operation"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy || disabled || (isPull && freshness.filesCurrent !== false)) return;
        await start({
          projectId,
          branch,
          ...(reviewsOnly ? { reviewsOnly: true } : {}),
          ...(createReview
            ? {
                title,
                description: String(new FormData(event.currentTarget).get("description") ?? ""),
              }
            : {}),
        });
      }}
    >
      {createReview ? (
        <>
          <label>
            Название {reviewLabel}
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
              minLength={3}
              maxLength={255}
              disabled={busy || disabled}
            />
          </label>
          <ReviewDescription reviewLabel={reviewLabel} disabled={busy || disabled} />
        </>
      ) : null}
      {createReview ? (
        <div className="git-operation-actions">
          {children}
          {submitButton}
        </div>
      ) : isPull && !busy && freshness.remoteMissing ? (
        <GitRemoteMissingStatus />
      ) : isPull && !busy && freshness.filesCurrent === null ? (
        <GitFreshnessCheck
          checking={freshness.checking}
          disabled={disabled}
          onCheck={freshness.refresh}
        />
      ) : isPull && !busy && upToDate ? (
        <GitCurrentStatus branchCurrent={freshness.includesDefaultBranch === true} />
      ) : (
        submitButton
      )}
      {message ? <p role={error ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}

export function SubmissionRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const refresh = () => router.refresh();
    const timer = setInterval(refresh, 30_000);
    window.addEventListener("online", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("online", refresh);
    };
  }, [active, router]);
  return null;
}
