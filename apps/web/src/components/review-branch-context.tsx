"use client";

import { GitBranch, GitPullRequest } from "lucide-react";
import Link from "next/link";
import { Fragment, type ReactNode } from "react";
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
  reviewBranches,
  reviewLabel,
}: {
  projectId: string;
  defaultBranch: string;
  reviewBranches: string[];
  reviewLabel: string;
}) {
  const current = useProjectBranch(projectId, defaultBranch);
  if (current === defaultBranch || reviewBranches.includes(current)) return null;
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
