import { Status } from "@pushdocs/ui";
import { AlertTriangle, FileImage, FileText, GitBranch, Send, UserRound } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  resolveConflictAction,
  retryChangeSetSubmissionAction,
  submitChangeSetAction,
} from "@/app/actions";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Изменения" };

function fileCountText(count: number): string {
  const ending = count % 10;
  const lastTwo = count % 100;
  const word =
    ending === 1 && lastTwo !== 11
      ? "файл"
      : ending >= 2 && ending <= 4 && (lastTwo < 12 || lastTwo > 14)
        ? "файла"
        : "файлов";
  return `${count} ${word}`;
}

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const access = await repository().requireProjectAccess(user.id, projectId, "project:read");
  const branch = (await searchParams).branch ?? project.defaultBranch;
  const drafts = await repository().listDraftFiles(projectId, branch);
  const attachments = (await repository().listAttachments(projectId)).filter(
    (attachment) =>
      attachment.branch === branch &&
      ["open", "conflicted", "submitting"].includes(attachment.change_set_status),
  );
  const conflicts = await repository().listConflicts(projectId, branch);
  const changeSetId = drafts[0]?.change_set_id ?? attachments[0]?.change_set_id;
  const changeSet = drafts[0];
  const changeSetStatus = changeSet?.status ?? attachments[0]?.change_set_status;
  const submission = await repository().getSubmissionStatus(projectId, branch);
  const fileCount = drafts.length + attachments.length;
  const files = fileCountText(fileCount);

  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Изменения в ветке</h1>
          <p>
            {files} {fileCount === 1 ? "сохранён" : "сохранены"} в PushDocs и ещё не
            {fileCount === 1 ? " отправлен" : " отправлены"} в Git.
          </p>
        </div>
        <span className="branch-placeholder">
          <GitBranch aria-hidden size={15} />
          {branch}
        </span>
      </header>

      <ol className="workflow-steps" aria-label="Этапы отправки">
        <li className="active">
          <i>1</i> Черновик
        </li>
        <li>
          <i>2</i> Коммит в ветку
        </li>
        <li>
          <i>3</i> PR / MR
        </li>
      </ol>

      {fileCount === 0 ? (
        <section className="empty-state">
          <FileText aria-hidden />
          <h2>В ветке нет черновиков</h2>
          <p>Измените документ или загрузите файл, чтобы подготовить один общий коммит.</p>
          <Link
            className="pd-button pd-button--primary"
            href={`/projects/${projectId}/documents?branch=${encodeURIComponent(branch)}`}
          >
            Открыть документы
          </Link>
        </section>
      ) : (
        <div className="changes-layout">
          <section className="changes-files">
            <header>
              <h2>Файлы</h2>
              <Status tone={changeSet?.status === "conflicted" ? "warning" : "neutral"}>
                {conflicts.length > 0 ? "Есть конфликт" : files}
              </Status>
            </header>
            {drafts.map((draft) => (
              <article className="change-file" key={draft.path}>
                <span className="file-kind">
                  {/\.(png|jpe?g|gif|webp|svg)$/i.test(draft.path) ? (
                    <FileImage aria-hidden />
                  ) : (
                    <FileText aria-hidden />
                  )}
                </span>
                <span>
                  <strong>{draft.path}</strong>
                  <small>
                    <UserRound aria-hidden size={12} />
                    {draft.author_name}
                  </small>
                </span>
                <b className={`operation operation--${draft.operation}`}>
                  {draft.operation === "add" ? "A" : draft.operation === "delete" ? "D" : "M"}
                </b>
              </article>
            ))}
            {attachments.map((attachment) => (
              <article className="change-file" key={attachment.id}>
                <span className="file-kind">
                  <FileImage aria-hidden />
                </span>
                <span>
                  <strong>{attachment.repository_path}</strong>
                  <small>{attachment.original_name}</small>
                </span>
                <b className="operation operation--add">A</b>
              </article>
            ))}
          </section>

          <form action={submitChangeSetAction} className="submit-panel">
            <p className="eyebrow">Отправка изменений</p>
            <h2>Один коммит для ветки</h2>
            <input name="projectId" type="hidden" value={projectId} />
            <input name="changeSetId" type="hidden" value={changeSetId} />
            <input name="branch" type="hidden" value={branch} />
            <label>
              Сообщение коммита
              <textarea
                name="message"
                defaultValue="Обновить документацию через PushDocs"
                required
              />
            </label>
            {branch !== project.defaultBranch ? (
              <label className="checkbox-field">
                <input name="createReview" type="checkbox" defaultChecked />
                Создать PR / MR в {project.defaultBranch}
              </label>
            ) : null}
            <div className="submit-summary">
              <span>{files}</span>
              {changeSet ? <span>Ревизия {changeSet.change_set_revision}</span> : null}
              {changeSet ? (
                <span className="commit-sha">{changeSet.base_commit_sha.slice(0, 8)}</span>
              ) : null}
            </div>
            <button
              className="pd-button pd-button--primary"
              disabled={
                access.role === "reader" ||
                !changeSetId ||
                changeSetStatus === "submitting" ||
                conflicts.length > 0
              }
              type="submit"
            >
              <Send aria-hidden size={16} />
              {changeSetStatus === "submitting"
                ? "Изменения заблокированы на время отправки"
                : "Отправить в ветку"}
            </button>
            {submission ? (
              <div role="status" className="panel-note">
                <p>
                  {submission.status === "failed"
                    ? "Отправка остановлена. Результат записи в Git будет проверен при повторе."
                    : "Отправка в очереди или выполняется. Черновики сохранены."}
                </p>
                {submission.last_error ? <p>{submission.last_error}</p> : null}
                {submission.status === "failed" && access.role !== "reader" ? (
                  <button
                    className="pd-button"
                    type="submit"
                    formAction={retryChangeSetSubmissionAction}
                    formNoValidate
                  >
                    Проверить результат и повторить
                  </button>
                ) : null}
              </div>
            ) : null}
            <p className="panel-note">
              Ветка обновляется только относительно проверенного SHA. Если Git изменился, PushDocs
              остановит отправку и покажет конфликт.
            </p>
          </form>
        </div>
      )}
      {conflicts.length > 0 ? (
        <section className="conflicts-section">
          <header>
            <AlertTriangle aria-hidden />
            <div>
              <p className="eyebrow">Требуется решение</p>
              <h2>Конфликты с актуальной веткой</h2>
            </div>
          </header>
          {conflicts.map((conflict) => (
            <form action={resolveConflictAction} className="conflict-card" key={conflict.id}>
              <input name="conflictId" type="hidden" value={conflict.id} />
              <input name="projectId" type="hidden" value={projectId} />
              <h3>{conflict.path}</h3>
              {conflict.resolution ? (
                <p role="status">Решение сохранено. Осталось разрешить другие конфликты.</p>
              ) : null}
              {conflict.kind === "binary" ? (
                <div className="conflict-columns">
                  <figure>
                    <figcaption>Версия из Git</figcaption>
                    {conflict.theirs_content ? (
                      <a
                        href={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: conflict.path, version: "git" })}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть файл из Git
                      </a>
                    ) : (
                      <p>Файл удалён</p>
                    )}
                    {conflict.theirs_content &&
                    /\.(png|jpe?g|gif|webp|avif)$/i.test(conflict.path) ? (
                      // biome-ignore lint/performance/noImgElement: authenticated images must not pass through the public image optimizer
                      <img
                        alt="Версия изображения из Git"
                        src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: conflict.path, version: "git" })}`}
                        style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain" }}
                      />
                    ) : null}
                  </figure>
                  <figure>
                    <figcaption>Версия PushDocs</figcaption>
                    {conflict.ours_content ? (
                      <a
                        href={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: conflict.path })}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Открыть загруженный файл
                      </a>
                    ) : (
                      <p>Файл удалён</p>
                    )}
                    {conflict.ours_content &&
                    /\.(png|jpe?g|gif|webp|avif)$/i.test(conflict.path) ? (
                      // biome-ignore lint/performance/noImgElement: authenticated images must not pass through the public image optimizer
                      <img
                        alt="Версия изображения PushDocs"
                        src={`/api/projects/${projectId}/assets?${new URLSearchParams({ branch, path: conflict.path })}`}
                        style={{ maxWidth: "100%", maxHeight: 280, objectFit: "contain" }}
                      />
                    ) : null}
                  </figure>
                  <input name="resolvedContent" type="hidden" value="" />
                </div>
              ) : (
                <>
                  <details className="conflict-base">
                    <summary>Показать базовую версию</summary>
                    <pre>{conflict.base_content ?? "[файла не было]"}</pre>
                  </details>
                  <div className="conflict-columns">
                    <label>
                      Версия из Git
                      <textarea readOnly value={conflict.theirs_content ?? "[файл удалён]"} />
                    </label>
                    <label>
                      Версия PushDocs
                      <textarea readOnly value={conflict.ours_content ?? "[удалить файл]"} />
                    </label>
                    <label>
                      Итог
                      <textarea
                        name="resolvedContent"
                        defaultValue={conflict.ours_content ?? conflict.theirs_content ?? ""}
                      />
                    </label>
                  </div>
                </>
              )}
              <div className="conflict-actions">
                <button
                  disabled={access.role === "reader" || !!conflict.resolution}
                  className="pd-button pd-button--secondary"
                  name="resolution"
                  type="submit"
                  value="theirs"
                >
                  Взять из Git
                </button>
                <button
                  disabled={access.role === "reader" || !!conflict.resolution}
                  className="pd-button pd-button--secondary"
                  name="resolution"
                  type="submit"
                  value="ours"
                >
                  Взять из PushDocs
                </button>
                <button
                  disabled={
                    access.role === "reader" || !!conflict.resolution || conflict.kind === "binary"
                  }
                  className="pd-button pd-button--primary"
                  name="resolution"
                  type="submit"
                  value="manual"
                >
                  Сохранить итог
                </button>
              </div>
            </form>
          ))}
        </section>
      ) : null}
    </div>
  );
}
