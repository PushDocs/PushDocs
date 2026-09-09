import { AlertTriangle, FileText, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { resolveConflictAction, retryChangeSetSubmissionAction } from "@/app/actions";
import { ChangeReview } from "@/components/change-review";
import { GitOperation, SubmissionRefresh } from "@/components/git-operation";
import { ProjectContext } from "@/components/project-context";
import { SubmitChanges } from "@/components/submit-changes";
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
  const working = await repository().listWorkingFiles(projectId, branch);
  const reviewLabel = project.provider === "gitlab" ? "MR" : "PR";
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
  const review = (await repository().listChangeRequests(projectId)).find(
    (item) => item.source_branch === branch && item.state === "open",
  );
  const fileCount = new Set([
    ...drafts.map((file) => file.path),
    ...attachments.map((file) => file.repository_path),
  ]).size;
  const files = fileCountText(fileCount);
  const workingByPath = new Map(working.files.map((file) => [file.path, file]));
  const repositoryPaths = new Set(working.branch.repository_paths);
  const attachmentPaths = new Set(attachments.map((file) => file.repository_path));

  return (
    <div className="page changes-page">
      <ProjectContext projectId={projectId} branch={branch} />
      <SubmissionRefresh
        active={submission?.status === "queued" || submission?.status === "running"}
      />
      <header className="page-header">
        <div>
          <h1>Изменения в ветке</h1>
          {fileCount > 0 ? (
            <p>
              {files} {fileCount === 1 ? "сохранён" : "сохранены"} в PushDocs и ещё не
              {fileCount === 1 ? " отправлен" : " отправлены"} в Git.
            </p>
          ) : null}
        </div>
        <span className="branch-placeholder">
          <GitBranch aria-hidden size={15} />
          {branch}
        </span>
      </header>

      <div className="branch-git-actions">
        <GitOperation
          projectId={projectId}
          branch={branch}
          reviewLabel={reviewLabel}
          disabled={changeSetStatus === "submitting"}
        />
        {review ? (
          <Link
            className="pd-button pd-button--secondary"
            href={`/projects/${projectId}/reviews?review=${review.id}`}
          >
            Открыть {reviewLabel}: {review.title}
          </Link>
        ) : null}
        <Link
          className="pd-button pd-button--secondary"
          href={`/projects/${projectId}/documents?${new URLSearchParams({ branch })}`}
        >
          Редактировать ветку
        </Link>
      </div>
      {fileCount === 0 ? (
        <section className="empty-state">
          <FileText aria-hidden />
          <h2>Все изменения отправлены</h2>
          {!review && branch !== project.defaultBranch ? (
            <GitOperation
              projectId={projectId}
              branch={branch}
              createReview
              reviewLabel={reviewLabel}
              disabled={access.role === "reader"}
            />
          ) : null}

          <Link
            className="pd-button pd-button--primary"
            href={`/projects/${projectId}/documents?branch=${encodeURIComponent(branch)}`}
          >
            Открыть документы
          </Link>
        </section>
      ) : (
        <div className="changes-layout">
          <ChangeReview
            revertContext={
              access.role !== "reader" && working.changeSet?.status === "open"
                ? {
                    revision: working.changeSet.revision,
                    ownerId: user.id,
                    canEditConfig: access.role === "admin",
                  }
                : undefined
            }
            projectId={projectId}
            branch={branch}
            files={[
              ...drafts
                .filter((draft) => !attachmentPaths.has(draft.path))
                .map((draft) => {
                  const file = workingByPath.get(draft.path);
                  return {
                    path: draft.path,
                    operation: draft.operation,
                    before: file?.baseContent ?? "",
                    after: draft.operation === "delete" ? "" : (file?.content ?? ""),
                    binary: /\.(png|jpe?g|gif|webp|avif|svg|pdf|zip|mp4)$/i.test(draft.path),
                    existed: repositoryPaths.has(draft.path),
                  };
                }),
              ...attachments.map((file) => ({
                path: file.repository_path,
                operation: repositoryPaths.has(file.repository_path) ? "modify" : "add",
                before: "",
                after: "",
                binary: true,
                existed: repositoryPaths.has(file.repository_path),
              })),
            ]}
          />

          <SubmitChanges
            projectId={projectId}
            changeSetId={changeSetId ?? ""}
            branch={branch}
            defaultBranch={project.defaultBranch}
            reviewTitle={review?.title}
            reviewLabel={reviewLabel}
            submitting={changeSetStatus === "submitting"}
            disabled={
              access.role === "reader" ||
              !changeSetId ||
              changeSetStatus === "submitting" ||
              conflicts.length > 0
            }
          >
            {submission && submission.status !== "done" ? (
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
          </SubmitChanges>
        </div>
      )}
      {conflicts.length > 0 ? (
        <section className="conflicts-section">
          <header>
            <AlertTriangle aria-hidden />
            <div>
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
