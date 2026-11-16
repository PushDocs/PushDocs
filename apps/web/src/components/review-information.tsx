import type { ChangeRequestDetails } from "@pushdocs/contracts";
import { Status } from "@pushdocs/ui";
import type { ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { branchUpdateLabels } from "./git-operation-labels";

const reasons: Record<string, string> = {
  draft_status: "Черновик нужно перевести в готовый к проверке режим.",
  conflict: "Есть конфликты с основной веткой.",
  not_approved: "Не хватает обязательных одобрений.",
  requested_changes: "Ревьюеры запросили изменения.",
  discussions_not_resolved: "Остались незавершённые обсуждения.",
  ci_must_pass: "Обязательные проверки должны пройти успешно.",
  ci_still_running: "Проверки ещё выполняются.",
  security_policy_pipeline_check: "Ожидается успешное завершение проверок безопасности.",
  need_rebase: "Нужно обновить ветку относительно основной.",
  behind: "Нужно обновить ветку относительно основной.",
  dirty: "Есть конфликты с основной веткой.",
  unstable: "Есть непройденные проверки.",
  blocked: "Не выполнены условия слияния, заданные в GitHub.",
  merge_request_blocked: "Слияние заблокировано другим MR.",
  merge_time: "Время, разрешённое для слияния, ещё не наступило.",
  not_open: "Запрос на слияние уже закрыт.",
};

function safeMarkdown(source: string) {
  return source.replace(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>\n]*>/g, "");
}

const resolveConflictsAction = "Разрешить конфликты";
const failedChecksAction = "Проверить ошибки CI";
const readinessActions: Record<string, string> = {
  need_rebase: branchUpdateLabels.idle,
  behind: branchUpdateLabels.idle,
  conflict: resolveConflictsAction,
  dirty: resolveConflictsAction,
  not_approved: "Нужны одобрения",
  requested_changes: "Внести правки",
  discussions_not_resolved: "Закрыть обсуждения",
  ci_must_pass: failedChecksAction,
  unstable: failedChecksAction,
  ci_still_running: "Дождаться проверок",
  security_policy_pipeline_check: "Дождаться проверок безопасности",
  draft_status: "Снять статус черновика",
  merge_request_blocked: "Дождаться другого MR",
  merge_time: "Дождаться времени слияния",
};

export function ReviewReadiness({
  details,
  showAction = false,
}: {
  details: ChangeRequestDetails | null | undefined;
  showAction?: boolean;
}) {
  const state = details?.readiness.state ?? "unknown";
  return (
    <Status tone={state === "ready" ? "success" : state === "blocked" ? "warning" : "neutral"}>
      {showAction && state === "blocked"
        ? (readinessActions[details?.readiness.reason ?? ""] ?? "Проверить условия слияния")
        : {
            ready: "Готов к слиянию",
            blocked: "Не готов к слиянию",
            checking: "Готовность проверяется",
            unknown: "Готовность неизвестна",
          }[state]}
    </Status>
  );
}

export function ReviewInformation({
  details,
  conflictFiles,
  readinessNotice,
  showReadiness = true,
}: {
  details: ChangeRequestDetails | null | undefined;
  conflictFiles?: ReactNode;
  readinessNotice?: ReactNode;
  showReadiness?: boolean;
}) {
  const state = details?.readiness.state ?? "unknown";
  const approvals = details?.approvals;
  const comments = details?.comments;
  return (
    <div className="review-information">
      {showReadiness ? (
        <section aria-label="Готовность к слиянию">
          <h3>Готовность к слиянию</h3>
          <ReviewReadiness details={details} />
          {readinessNotice ??
            (state === "blocked" ? (
              <p>
                {reasons[details?.readiness.reason ?? ""] ??
                  "Git-провайдер сообщает, что условия слияния ещё не выполнены."}
              </p>
            ) : state === "checking" ? (
              <p>Git-провайдер проверяет возможность слияния.</p>
            ) : state === "unknown" ? (
              <p>Git-провайдер пока не предоставил статус готовности.</p>
            ) : null)}
          {conflictFiles}
        </section>
      ) : null}
      <section aria-label="Лейблы">
        <h3>Лейблы</h3>
        {details?.labels ? (
          details.labels.length ? (
            <ul className="review-labels">
              {details.labels.map((label) => (
                <li key={label.name}>
                  <i
                    aria-hidden
                    style={{
                      backgroundColor: /^#[\da-f]{6}$/i.test(label.color ?? "")
                        ? (label.color ?? undefined)
                        : undefined,
                    }}
                  />
                  {label.name}
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">Нет лейблов.</p>
          )
        ) : (
          <p className="muted">Лейблы недоступны.</p>
        )}
      </section>
      <section aria-label="Одобрения">
        <h3>Одобрения</h3>
        {approvals ? (
          <>
            <p>
              Получено:{" "}
              {approvals.reviewers.filter((reviewer) => reviewer.state === "approved").length}
              {approvals.required !== null ? ` · Требуется: ${approvals.required}` : ""}
              {approvals.remaining !== null && approvals.remaining > 0
                ? ` · Осталось: ${approvals.remaining}`
                : ""}
            </p>
            {approvals.reviewers.length ? (
              <ul className="review-approvals">
                {approvals.reviewers.map((reviewer) => (
                  <li key={reviewer.id ?? reviewer.name}>
                    <strong>{reviewer.name}</strong>
                    <Status tone={reviewer.state === "approved" ? "success" : "warning"}>
                      {reviewer.state === "approved" ? "Одобрено" : "Запрошены изменения"}
                    </Status>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted">Пока нет одобрений.</p>
            )}
          </>
        ) : (
          <p className="muted">Одобрения недоступны.</p>
        )}
      </section>
      <section aria-label="Комментарии">
        <h3>Комментарии</h3>
        {comments ? (
          <>
            {!details?.commentsComplete ? (
              <p className="muted">Часть комментариев недоступна.</p>
            ) : null}
            {comments.length ? (
              <ol className="review-comments">
                {comments.map((comment) => (
                  <li key={comment.id}>
                    <header>
                      <strong>{comment.author}</strong>
                      <time dateTime={comment.createdAt}>
                        {new Date(comment.createdAt).toLocaleString("ru-RU")}
                      </time>
                    </header>
                    <div className="review-comment-markdown">
                      <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        skipHtml
                        disallowedElements={["img"]}
                      >
                        {safeMarkdown(comment.body)}
                      </ReactMarkdown>
                    </div>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="muted">Нет комментариев.</p>
            )}
          </>
        ) : (
          <p className="muted">Комментарии недоступны.</p>
        )}
      </section>
    </div>
  );
}
