import { evaluateMergeReadiness } from "@pushdocs/domain";
import { Status } from "@pushdocs/ui";
import { CheckCircle2, CircleDot, ExternalLink, GitPullRequest, XCircle } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "PR и MR" };

export default async function ReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ review?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  await repository().requireProjectAccess(user.id, projectId);
  const reviews = await repository().listChangeRequests(projectId);
  const requestedId = (await searchParams).review;
  const selected = reviews.find((review) => review.id === requestedId) ?? reviews[0];
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

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>PR / MR</h1>
          <p>Проверки обновляются по данным Git-провайдера.</p>
        </div>
      </header>
      {reviews.length === 0 ? (
        <section className="empty-state">
          <GitPullRequest aria-hidden />
          <h2>Нет открытых запросов на слияние</h2>
          <p>После отправки рабочей ветки здесь появятся PR или MR и результаты CI.</p>
        </section>
      ) : (
        <div className="reviews-layout">
          <nav className="review-list" aria-label="Запросы на слияние">
            {reviews.map((review) => (
              <Link
                className={review.id === selected?.id ? "active" : ""}
                href={`?review=${review.id}`}
                key={review.id}
              >
                <GitPullRequest aria-hidden size={17} />
                <span>
                  <strong>{review.title}</strong>
                  <small>
                    !{review.external_id} {review.source_branch} → {review.target_branch}
                  </small>
                </span>
              </Link>
            ))}
          </nav>
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
                <a
                  className="pd-button pd-button--secondary"
                  href={selected.provider_url}
                  rel="noreferrer"
                  target="_blank"
                >
                  Открыть в Git
                  <ExternalLink aria-hidden size={15} />
                </a>
              </header>
              <div className="review-columns">
                <div className="checks-panel">
                  <div className="checks-title">
                    <div>
                      <p className="eyebrow">Проверки для</p>
                      <code>{selected.head_sha.slice(0, 8)}</code>
                    </div>
                    <Status tone={readiness.ready ? "success" : "warning"}>
                      {readiness.ready ? "Готово" : "Ожидание"}
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
                        <b>{check.conclusion}</b>
                      </div>
                    ))
                  )}
                </div>
                <aside className="merge-panel">
                  <h3>Готовность к слиянию</h3>
                  <p>
                    {readiness.ready
                      ? "Обязательные проверки пройдены."
                      : "Есть незавершённые или неуспешные проверки."}
                  </p>
                  <button className="pd-button pd-button--primary" disabled type="button">
                    Слить в {selected.target_branch}
                  </button>
                  <small>Слияние дополнительно проверяет роль и актуальный SHA.</small>
                </aside>
              </div>
            </section>
          ) : null}
        </div>
      )}
    </div>
  );
}
