import {
  BranchUpdateStrategy,
  branchUpdateStrategy,
  branchUpdateWaitingStatus,
  hasBranchConflicts,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { AlertTriangle, Check, FileText, GitBranch } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import {
  resolveConflictAction,
  retryChangeSetSubmissionAction,
  submitChangeSetAction,
} from "@/app/actions";
import { BranchConflictNotice, BranchConflictResolver } from "@/components/branch-conflicts";
import { BranchImport } from "@/components/branch-import";
import { ChangeReview } from "@/components/change-review";
import { GitOperation, SubmissionRefresh } from "@/components/git-operation";
import { ProjectContext } from "@/components/project-context";
import { ReviewBranchUpdate } from "@/components/review-branch-update";
import { SubmitChanges } from "@/components/submit-changes";
import { repository, requireUser } from "@/lib/server";

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

function BranchWorkflow({ stage, reviewLabel }: { stage: 1 | 2 | 3; reviewLabel: string }) {
  const steps = ["Правки", "Коммит в ветку", reviewLabel];
  return (
    <ol className="branch-workflow" aria-label="Этапы работы с веткой">
      {steps.map((label, index) => {
        const position = (index + 1) as 1 | 2 | 3;
        const complete = position < stage;
        const active = position === stage;
        return (
          <li
            className={complete ? "complete" : active ? "active" : undefined}
            aria-current={active ? "step" : undefined}
            key={label}
          >
            <span>{complete ? <Check aria-hidden size={13} /> : position}</span>
            {label}
          </li>
        );
      })}
    </ol>
  );
}

export default async function ChangesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; resolve?: string; conflict?: string }>;
}) {
  const [user, { projectId }, query] = await Promise.all([requireUser(), params, searchParams]);
  const store = repository();
  const project = await store.getProjectForUser(user.id, projectId);
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const conflictReviewId = query.resolve ?? query.conflict;
  const requestedReview = conflictReviewId
    ? (await store.listChangeRequests(projectId, "open")).find(
        (item) => item.id === conflictReviewId,
      )
    : undefined;
  if (conflictReviewId && requestedReview?.details?.source?.isFork !== false)
    return (
      <div className="not-found-panel">
        Исходная ветка PR / MR недоступна для разрешения конфликтов.
      </div>
    );
  const resolver =
    query.resolve && requestedReview ? (
      <BranchConflictResolver
        key={requestedReview.id}
        projectId={projectId}
        reviewId={requestedReview.id}
        branch={requestedReview.source_branch}
        targetBranch={requestedReview.target_branch}
        defaultBranch={project.defaultBranch}
        ownerId={user.id}
        canWrite={project.role !== "reader"}
        providerUrl={requestedReview.provider_url}
        reviewLabel={project.provider === "gitlab" ? "MR" : "PR"}
      />
    ) : undefined;
  const access = { role: project.role };
  const branch =
    (query.resolve ? requestedReview?.source_branch : query.branch) ?? project.defaultBranch;
  const branches = await store.listBranches(projectId);
  const localBranch = branches.find((item) => item.full_ref === branch);
  if (!localBranch)
    return resolver ?? <BranchImport key={branch} projectId={projectId} branch={branch} />;
  const [drafts, working, attachments, conflicts, submission, openReview, activeUpdate] =
    await Promise.all([
      store.listDraftFiles(projectId, branch),
      store.listChangedWorkingFiles(projectId, branch),
      store.listAttachmentsForBranch(projectId, branch),
      store.listConflicts(projectId, branch),
      store.getSubmissionStatus(projectId, branch),
      store.findOpenChangeRequestByBranch(projectId, branch),
      store.getActiveReviewBranchUpdate(projectId, branch),
    ]);
  const activePayload = activeUpdate?.payload as
    | { reviewId: string; strategy: BranchUpdateStrategy; expectedHeadSha: string }
    | undefined;
  const review =
    openReview ??
    (activePayload
      ? (await store.listChangeRequests(projectId)).find(
          (item) => item.id === activePayload.reviewId,
        )
      : undefined);
  if (
    !activeUpdate &&
    working.branch.repository_paths.length === 0 &&
    working.files.length === 0 &&
    drafts.length === 0 &&
    attachments.length === 0 &&
    !(await store.hasImportedBranch(localBranch.id))
  )
    return resolver ?? <BranchImport key={branch} projectId={projectId} branch={branch} />;
  const reviewLabel = project.provider === "gitlab" ? "MR" : "PR";
  const conflictReview = requestedReview ?? review;
  const branchHasConflicts = hasBranchConflicts(conflictReview?.details?.readiness.reason);
  const rebaseRequired =
    branchUpdateStrategy(conflictReview?.details) === BranchUpdateStrategy.Rebase;
  const branchNeedsUpdate = Boolean(review && (needsBranchUpdate(review.details) || activeUpdate));
  const branchNeedsAttention = branchHasConflicts || branchNeedsUpdate;
  const reviewUrl =
    review?.state === "open"
      ? `/projects/${projectId}/reviews?${new URLSearchParams({ review: review.id })}`
      : review?.provider_url;
  const changeSetId = drafts[0]?.change_set_id ?? attachments[0]?.change_set_id;
  const changeSet = drafts[0];
  const changeSetStatus = changeSet?.status ?? attachments[0]?.change_set_status;
  const submissionNeedsRecovery =
    changeSetStatus === "submitting" && submission?.status === "failed";
  const fileCount = new Set([
    ...drafts.map((file) => file.path),
    ...attachments.map((file) => file.repository_path),
  ]).size;
  const hasPendingChanges =
    fileCount > 0 || changeSetStatus === "submitting" || changeSetStatus === "conflicted";
  if (resolver && fileCount === 0) return resolver;
  const files = fileCountText(fileCount);
  const workingByPath = new Map(working.files.map((file) => [file.path, file]));
  const repositoryPaths = new Set(working.branch.repository_paths);
  const attachmentPaths = new Set(attachments.map((file) => file.repository_path));
  const workflowStage: 1 | 2 | 3 =
    fileCount > 0
      ? 1
      : submission?.status === "queued" || submission?.status === "running"
        ? 2
        : review || (branch !== project.defaultBranch && submission?.status === "done")
          ? 3
          : 1;

  const documentsLink = (
    <Link
      className="pd-button pd-button--secondary"
      href={`/projects/${projectId}/documents?branch=${encodeURIComponent(branch)}`}
    >
      Открыть документы
    </Link>
  );

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
        <div className="changes-header-actions">
          <span className="branch-placeholder">
            <GitBranch aria-hidden size={15} />
            {branch}
          </span>
        </div>
      </header>

      <BranchWorkflow stage={workflowStage} reviewLabel={reviewLabel} />

      {review && branchNeedsUpdate && (activeUpdate || !branchHasConflicts || rebaseRequired) ? (
        <ReviewBranchUpdate
          waitingForResolution={activeUpdate?.status === branchUpdateWaitingStatus}
          review={review}
          provider={project.provider}
          projectId={projectId}
          ownerId={user.id}
          canWrite={project.role !== "reader"}
          activeStrategy={activePayload?.strategy}
          activeHeadSha={activePayload?.expectedHeadSha}
          hasPendingChanges={hasPendingChanges}
        />
      ) : branchHasConflicts && conflictReview ? (
        <BranchConflictNotice
          projectId={projectId}
          reviewId={conflictReview.id}
          branch={conflictReview.source_branch}
          targetBranch={conflictReview.target_branch}
          currentBranch={branch}
          ownerId={user.id}
          hasPendingChanges={hasPendingChanges}
          canWrite={conflictReview.details?.source?.isFork === false && access.role !== "reader"}
          providerUrl={conflictReview.provider_url}
          reviewLabel={reviewLabel}
        />
      ) : null}

      {fileCount > 0 || !branchNeedsAttention ? (
        <div className="branch-git-actions">
          <GitOperation
            projectId={projectId}
            branch={branch}
            reviewLabel={reviewLabel}
            disabled={changeSetStatus === "submitting"}
          />
          {review && reviewUrl && fileCount > 0 ? (
            <Link
              className="pd-button pd-button--secondary"
              href={reviewUrl}
              target={review.state === "open" ? undefined : "_blank"}
              rel={review.state === "open" ? undefined : "noreferrer"}
            >
              Открыть {reviewLabel}: {review.title}
            </Link>
          ) : null}
          {fileCount > 0 ? (
            <SubmitChanges
              action={submitChangeSetAction}
              retryAction={
                submissionNeedsRecovery && access.role !== "reader"
                  ? retryChangeSetSubmissionAction
                  : undefined
              }
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
              {changeSetStatus === "submitting" && submission && submission.status !== "done" ? (
                <div role="status" className="panel-note">
                  <p>
                    {submission.status === "failed"
                      ? "Отправка остановлена. Результат записи в Git будет проверен при повторе."
                      : "Отправка в очереди или выполняется. Черновики сохранены."}
                  </p>
                  {submission.last_error ? <p>{submission.last_error}</p> : null}
                </div>
              ) : null}
            </SubmitChanges>
          ) : null}
        </div>
      ) : null}
      {fileCount === 0 ? (
        <section className="empty-state">
          <FileText aria-hidden />
          <h2>{branchNeedsAttention ? "Нет локальных правок" : "Все изменения отправлены"}</h2>
          {review && reviewUrl ? (
            <Link
              className={`pd-button pd-button--${branchNeedsAttention ? "secondary" : "primary"}`}
              href={reviewUrl}
              target={review.state === "open" ? undefined : "_blank"}
              rel={review.state === "open" ? undefined : "noreferrer"}
            >
              Открыть {reviewLabel}
            </Link>
          ) : null}
          {!review && branch !== project.defaultBranch ? (
            <GitOperation
              projectId={projectId}
              branch={branch}
              createReview
              reviewLabel={reviewLabel}
              disabled={access.role === "reader"}
            >
              {documentsLink}
            </GitOperation>
          ) : (
            documentsLink
          )}
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
