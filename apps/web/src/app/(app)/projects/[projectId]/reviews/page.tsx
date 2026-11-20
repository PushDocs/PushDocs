import {
  type BranchUpdateStrategy,
  branchUpdateWaitingStatus,
  hasBranchConflicts,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { evaluateMergeReadiness } from "@pushdocs/domain";
import { Status } from "@pushdocs/ui";
import { CheckCircle2, CircleDot, ExternalLink, GitPullRequest, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GitOperation } from "@/components/git-operation";
import { ReviewBranchAction } from "@/components/review-branch-action";
import {
  ReviewBranchList,
  ReviewBranchSwitch,
  ReviewMissingBranchNotice,
} from "@/components/review-branch-context";
import { ReviewInformation, ReviewReadiness } from "@/components/review-information";
import { externalPreviewUrl } from "@/lib/external-preview";
import { repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "PR и MR" };

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string; branch?: string; q?: string; state?: string }>;
}) {
  const [user, { projectId }, query] = await Promise.all([requireUser(), params, searchParams]);
  const store = repository();
  const project = await store.getProjectForUser(user.id, projectId);
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const reviews = await store.listChangeRequests(projectId, "open");
  const selected =
    reviews.find((review) => review.id === query.review) ??
    reviews.find((review) => review.source_branch === query.branch) ??
    reviews[0];
  const checks = selected?.head_sha
    ? (await store.listChecks(selected.id)).map((check) => ({
        conclusion: check.conclusion,
        durationMs: check.duration_ms,
        id: check.id,
        name: check.name,
        required: check.required,
        url: check.url,
      }))
    : [];
  const readiness = evaluateMergeReadiness(checks);
  const activeUpdate = selected
    ? await store.getActiveReviewBranchUpdate(projectId, selected.source_branch)
    : undefined;
  const reviewLabel = project.provider === "gitlab" ? "MR" : "PR";
  const hasBranchNotice = Boolean(
    selected &&
      (hasBranchConflicts(selected.details?.readiness.reason) ||
        needsBranchUpdate(selected.details) ||
        activeUpdate),
  );
  const pendingChanges =
    selected && hasBranchNotice
      ? await store.getBranchConflictBlockers(projectId, selected.source_branch)
      : undefined;
  const activePayload = activeUpdate?.payload as
    | { strategy: BranchUpdateStrategy; expectedHeadSha: string }
    | undefined;
  const branchHasConflicts =
    hasBranchConflicts(selected?.details?.readiness.reason) ||
    activeUpdate?.status === branchUpdateWaitingStatus;
  const branchAction = selected ? (
    <ReviewBranchAction
      projectId={projectId}
      review={selected}
      provider={project.provider}
      ownerId={user.id}
      canWrite={project.role !== "reader"}
      activeStrategy={activePayload?.strategy}
      activeHeadSha={activePayload?.expectedHeadSha}
      hasPendingChanges={Boolean(pendingChanges?.paths.length)}
      waitingForResolution={activeUpdate?.status === branchUpdateWaitingStatus}
      actionOnly={!branchHasConflicts}
    />
  ) : null;
  const providerName = project.provider === "gitlab" ? "GitLab" : "GitHub";
  const previewUrl = selected
    ? externalPreviewUrl(process.env.PUSHDOCS_PREVIEW_URL, selected.external_id)
    : undefined;
  const previewCheck = checks.find((check) => check.name === "preview:deploy");

  return (
    <div className="page reviews-page">
      <header className="page-header">
        <div>
          <h1>{reviewLabel}</h1>
        </div>
      </header>
      <div className="review-sync">
        <GitOperation
          projectId={projectId}
          branch={project.defaultBranch}
          reviewsOnly
          reviewLabel={reviewLabel}
        />
        {selected?.updated_at ? (
          <p className="muted">
            Обновлено из Git:{" "}
            <time dateTime={new Date(selected.updated_at).toISOString()}>
              {new Date(selected.updated_at).toLocaleString("ru-RU")}
            </time>
          </p>
        ) : null}
      </div>
      <ReviewMissingBranchNotice
        projectId={projectId}
        defaultBranch={project.defaultBranch}
        reviewLabel={reviewLabel}
        reviewBranches={reviews
          .filter((review) => review.details?.source?.isFork !== true)
          .map((review) => review.source_branch)}
      />
      {reviews.length === 0 ? (
        <section className="empty-state">
          <GitPullRequest aria-hidden />
          <h2>Нет открытых {reviewLabel}</h2>
          <p>После создания {reviewLabel} здесь появятся его состояние и результаты проверок.</p>
        </section>
      ) : (
        <div className="reviews-layout">
          <ReviewBranchList
            projectId={projectId}
            defaultBranch={project.defaultBranch}
            reviewLabel={reviewLabel}
            reviews={reviews.map((review) => ({
              id: review.id,
              branch: review.source_branch,
              isFork: review.details?.source?.isFork,
              content: (
                <Link
                  className={review.id === selected?.id ? "active" : ""}
                  href={`?${new URLSearchParams({ review: review.id })}`}
                  key={review.id}
                >
                  <GitPullRequest aria-hidden size={17} />
                  <span>
                    <strong>{review.title}</strong>
                    <small>
                      {project.provider === "gitlab" ? "!" : "#"}
                      {review.external_id} {review.source_branch} → {review.target_branch}
                    </small>
                    <span className="review-list-statuses">
                      <ReviewReadiness details={review.details} showAction />
                      {review.details?.source?.isFork === true ? (
                        <Status tone="neutral">Недоступно</Status>
                      ) : null}
                    </span>
                  </span>
                </Link>
              ),
            }))}
          />
          {selected ? (
            <section className="review-detail">
              <header className="review-heading">
                <div>
                  <Status tone="success">Открыт</Status>
                  <h2>{selected.title}</h2>
                  <p>
                    {selected.source_branch} → {selected.target_branch}
                  </p>
                </div>
                {branchHasConflicts ? branchAction : null}
              </header>
              <nav className="review-actions" aria-label={`Действия с ${reviewLabel}`}>
                <ReviewBranchSwitch
                  projectId={projectId}
                  branch={selected.source_branch}
                  defaultBranch={project.defaultBranch}
                  isFork={selected.details?.source?.isFork}
                />

                <div className="review-primary-actions">
                  <a
                    className="pd-button pd-button--secondary review-provider-link"
                    href={selected.provider_url}
                    rel="noreferrer"
                    target="_blank"
                  >
                    Открыть {reviewLabel} в {providerName}
                    <ExternalLink aria-hidden size={15} />
                  </a>
                  {!branchHasConflicts ? branchAction : null}
                  {previewUrl && previewCheck?.conclusion === "success" ? (
                    <a
                      className="pd-button pd-button--secondary"
                      href={previewUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      Открыть предпросмотр
                      <ExternalLink aria-hidden size={15} />
                    </a>
                  ) : previewUrl && previewCheck ? (
                    <button className="pd-button pd-button--secondary" disabled type="button">
                      {previewCheck?.conclusion === "failure"
                        ? "Предпросмотр не собран"
                        : previewCheck.conclusion === "running"
                          ? "Предпросмотр обновляется"
                          : "Предпросмотр недоступен"}
                    </button>
                  ) : null}
                </div>
                {selected.details?.source?.isFork ? (
                  <p className="panel-note">
                    {selected.details.source.branchUrl
                      ? "Ветка находится в форке. Переключение на ветки из форков недоступно."
                      : "Ветка находится в форке. Переключение на ветки из форков недоступно. Исходный репозиторий удалён или недоступен подключению PushDocs."}
                  </p>
                ) : !selected.details?.source ? (
                  <p className="panel-note">
                    Исходный репозиторий ещё не определён. Обновите данные из Git, чтобы открыть
                    ветку.
                  </p>
                ) : null}
              </nav>
              <ReviewInformation details={selected.details} showReadiness={!hasBranchNotice} />
              <div className="checks-panel">
                <div className="checks-title">
                  <div className="checks-heading">
                    <h3>Проверки</h3>
                    <code title="Коммит">
                      {selected.head_sha?.slice(0, 8) ?? "Коммит недоступен"}
                    </code>
                  </div>
                  <Status
                    tone={!checks.length ? "neutral" : readiness.ready ? "success" : "warning"}
                  >
                    {!checks.length ? "Нет данных" : readiness.ready ? "Готово" : "Ожидание"}
                  </Status>
                </div>
                {checks.length === 0 ? (
                  <p className="panel-note">Проверки для текущего коммита ещё не получены.</p>
                ) : (
                  checks.map((check) => (
                    <div className="check-row" key={check.id}>
                      {check.conclusion === "success" ? (
                        <CheckCircle2 className="success-icon" aria-hidden />
                      ) : check.conclusion === "failure" ? (
                        <XCircle
                          className={check.required ? "danger-icon" : "warning-icon"}
                          aria-hidden
                        />
                      ) : (
                        <CircleDot className="neutral-icon" aria-hidden />
                      )}
                      <span>
                        <strong>{check.name}</strong>
                        <small>{check.required ? "Обязательная" : "Допустима ошибка"}</small>
                      </span>
                      <b>
                        {
                          {
                            success: "Пройдена",
                            failure: "Ошибка",
                            running: "Выполняется",
                            skipped: "Пропущена",
                            neutral: "Завершена",
                          }[check.conclusion]
                        }
                      </b>
                    </div>
                  ))
                )}
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
