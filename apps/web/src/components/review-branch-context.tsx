"use client";

import { GitBranch, GitMerge, GitPullRequest, GitPullRequestClosed } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { type BranchReview, findBranchReview } from "@/lib/branch-review";
import { projectChangesHref } from "@/lib/project-paths";
import { useProjectBranch } from "./project-context";

type BranchProps = { projectId: string; branch: string; defaultBranch: string };

export function ReviewBranchList({
  projectId,
  defaultBranch,
  reviewLabel,
  reviews,
}: {
  projectId: string;
  defaultBranch: string;
  reviewLabel: string;
  reviews: { id: string; branch: string; isFork: boolean | undefined; content: ReactNode }[];
}) {
  const current = useProjectBranch(projectId, defaultBranch);
  const isCurrent = (review: (typeof reviews)[number]) =>
    review.isFork === false && review.branch === current;
  const currentReviews = reviews.filter(isCurrent);
  const otherReviews = reviews.filter((review) => !isCurrent(review));

  return (
    <nav className="review-sidebar" aria-label={`Список ${reviewLabel}`}>
      {currentReviews.length ? (
        <section className="review-current-section" aria-label={`${reviewLabel} текущей ветки`}>
          <h2>Текущая ветка</h2>
          <div className="review-list">
            {currentReviews.map((review) => (
              <Fragment key={review.id}>{review.content}</Fragment>
            ))}
          </div>
        </section>
      ) : null}
      {otherReviews.length ? (
        <div className="review-list">
          {otherReviews.map((review) => (
            <Fragment key={review.id}>{review.content}</Fragment>
          ))}
        </div>
      ) : null}
    </nav>
  );
}

export function ReviewMissingBranchNotice({
  projectId,
  defaultBranch,
  branchReviews,
  reviewLabel,
}: {
  projectId: string;
  defaultBranch: string;
  branchReviews: BranchReview[];
  reviewLabel: string;
}) {
  const current = useProjectBranch(projectId, defaultBranch);
  const review = findBranchReview(branchReviews, current);
  if (current === defaultBranch || review?.state === "open") return null;
  if (review)
    return (
      <div
        className={`review-missing-branch${review.state === "merged" ? " review-missing-branch--merged" : ""}`}
        role="note"
        aria-label={`${reviewLabel} текущей ветки`}
      >
        {review.state === "merged" ? (
          <GitMerge aria-hidden size={17} />
        ) : (
          <GitPullRequestClosed aria-hidden size={17} />
        )}
        <p>
          {reviewLabel} текущей ветки <strong title={current}>{current}</strong>{" "}
          {review.state === "merged" ? (
            <>
              влит в <strong>{review.target_branch}</strong>.
            </>
          ) : (
            <>закрыт без слияния.</>
          )}{" "}
          <a href={review.provider_url} target="_blank" rel="noreferrer">
            Открыть {reviewLabel}
          </a>
        </p>
      </div>
    );
  return (
    <div className="review-missing-branch" role="note" aria-label={`${reviewLabel} текущей ветки`}>
      <GitPullRequest aria-hidden size={17} />
      <p>
        Для текущей ветки <strong title={current}>{current}</strong> нет открытого {reviewLabel}.{" "}
        <Link href={projectChangesHref(projectId, current)}>К изменениям</Link>
      </p>
    </div>
  );
}

export function ReviewBranchSwitch({
  projectId,
  branch,
  defaultBranch,
  isFork,
}: BranchProps & { isFork: boolean | undefined }) {
  const current = useProjectBranch(projectId, defaultBranch);
  if (isFork === false && current === branch) return null;
  return isFork === false ? (
    <Link
      className="pd-button pd-button--primary"
      href={`/projects/${projectId}/documents?${new URLSearchParams({ branch })}`}
    >
      <GitBranch aria-hidden size={15} />
      Переключиться на ветку
    </Link>
  ) : (
    <button
      className="pd-button pd-button--primary"
      type="button"
      disabled
      title={
        isFork
          ? "Переключение на ветки из форков недоступно"
          : "Исходный репозиторий ещё не определён"
      }
    >
      <GitBranch aria-hidden size={15} />
      Переключиться на ветку
    </button>
  );
}
