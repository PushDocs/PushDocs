import { evaluateMergeReadiness } from "@pushdocs/domain";
import { Select, Status } from "@pushdocs/ui";
import {
  CheckCircle2,
  CircleDot,
  ExternalLink,
  GitBranch,
  GitPullRequest,
  XCircle,
} from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { GitOperation } from "@/components/git-operation";
import { externalPreviewUrl } from "@/lib/external-preview";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "PR и MR" };

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string; branch?: string; q?: string; state?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  await repository().requireProjectAccess(user.id, projectId);
  const allReviews = await repository().listChangeRequests(projectId);
  const query = await searchParams;
  const needle = query.q?.trim().toLocaleLowerCase() ?? "";
  const filterState = ["open", "merged", "closed"].includes(query.state ?? "")
    ? query.state
    : "all";
  const reviews = allReviews.filter(
    (review) =>
      (filterState === "all" || review.state === filterState) &&
      `${review.title} ${review.external_id} ${review.source_branch}`
        .toLocaleLowerCase()
        .includes(needle),
  );
  const selected =
    reviews.find((review) => review.id === query.review) ??
    reviews.find((review) => review.source_branch === query.branch && review.state === "open") ??
    reviews[0];
  const checks = selected
    ? (await repository().listChecks(selected.id)).map((check) => ({
        conclusion: check.conclusion,
        durationMs: check.duration_ms,
        id: check.id,
        name: check.name,
        required: check.required,
        url: check.url,
      }))
    : [];
  const readiness = evaluateMergeReadiness(checks);
  const reviewLabel = project.provider === "gitlab" ? "MR" : "PR";
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
      <form className="review-filters" method="get">
        <label>
          Найти {reviewLabel}
          <input name="q" defaultValue={query.q} placeholder="Название, номер или ветка" />
        </label>
        <Select
          name="state"
          label="Состояние"
          defaultValue={filterState}
          options={[
            { value: "all", label: "Все состояния" },
            { value: "open", label: "Открытые" },
            { value: "merged", label: "Слитые" },
            { value: "closed", label: "Закрытые" },
          ]}
        />
        <button className="pd-button pd-button--secondary" type="submit">
          Найти
        </button>
        {needle || filterState !== "all" ? (
          <Link href={`/projects/${projectId}/reviews`}>Сбросить</Link>
        ) : null}
      </form>
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
      {reviews.length === 0 ? (
        <section className="empty-state">
          <GitPullRequest aria-hidden />
          <h2>{allReviews.length ? `${reviewLabel} не найдены` : `Нет ${reviewLabel}`}</h2>
          <p>
            {allReviews.length
              ? "Измените текст поиска или сбросьте фильтры."
              : `После создания ${reviewLabel} здесь появятся результаты проверок.`}
          </p>
        </section>
      ) : (
        <div className="reviews-layout">
          <nav className="review-list" aria-label={`Список ${reviewLabel}`}>
            {reviews.map((review) => (
              <Link
                className={review.id === selected?.id ? "active" : ""}
                href={`?${new URLSearchParams({ review: review.id, q: query.q ?? "", state: filterState ?? "all" })}`}
                key={review.id}
              >
                <GitPullRequest aria-hidden size={17} />
                <span>
                  <strong>{review.title}</strong>
                  <small>
                    {project.provider === "gitlab" ? "!" : "#"}
                    {review.external_id} {review.source_branch} → {review.target_branch}
                  </small>
                </span>
              </Link>
            ))}
          </nav>
          {selected ? (
            <section className="review-detail">
              <header className="review-heading">
                <div>
                  <Status tone={selected.state === "open" ? "success" : "neutral"}>
                    {selected.state === "merged"
                      ? "Слит"
                      : selected.state === "closed"
                        ? "Закрыт"
                        : "Открыт"}
                  </Status>
                  <h2>{selected.title}</h2>
                  <p>
                    {selected.source_branch} → {selected.target_branch}
                  </p>
                </div>
              </header>
              <nav className="review-actions" aria-label={`Действия с ${reviewLabel}`}>
                <Link
                  className="pd-button pd-button--primary"
                  href={`/projects/${projectId}/documents?${new URLSearchParams({ branch: selected.source_branch })}`}
                  prefetch={false}
                >
                  <GitBranch aria-hidden size={15} />
                  Переключиться на ветку
                </Link>
                <a
                  className="pd-button pd-button--secondary review-provider-link"
                  href={selected.provider_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Открыть {reviewLabel} в {providerName}
                  <ExternalLink aria-hidden size={15} />
                </a>
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
              </nav>
              <div className="checks-panel">
                <div className="checks-title">
                  <div className="checks-heading">
                    <h3>Проверки</h3>
                    <code title="Коммит">{selected.head_sha.slice(0, 8)}</code>
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
