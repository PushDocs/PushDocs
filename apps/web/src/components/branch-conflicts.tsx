"use client";

import { BranchUpdateStrategy, ConflictInspectionStage } from "@pushdocs/contracts";
import { AlertTriangle, GitMerge, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";
import { projectChangesHref } from "@/lib/project-paths";
import { BranchConflictEditor } from "./branch-conflict-editor";
import {
  type ConflictInspectionTask,
  ConflictLoadState,
  conflictInspectionStore,
  useConflictInspection,
  useConflictInspections,
} from "./conflict-inspection";
import { pendingBranchChangesTitle } from "./git-operation-labels";
import { GitTransferStatus } from "./git-transfer-status";
import { ResolutionPhase, useConflictResolution } from "./use-conflict-resolution";
import { useLocalDraftChanges } from "./use-local-draft-changes";

const inspectionStages: Record<ConflictInspectionStage, string> = {
  [ConflictInspectionStage.Preparing]: "Подключаемся к Git…",
  [ConflictInspectionStage.Fetching]: "Загружаем данные веток…",
  [ConflictInspectionStage.Comparing]: "Сравниваем ветки и получаем нужные файлы…",
  [ConflictInspectionStage.Reading]: "Загружаем версии конфликтующих файлов…",
  [ConflictInspectionStage.Finalizing]: "Готовим список конфликтов…",
};
const branchConflictRegionLabel = "Конфликты между ветками";

function InspectionProgress({ task }: { task?: ConflictInspectionTask }) {
  return (
    <div
      className="conflict-load-progress"
      aria-live="polite"
      title={inspectionStages[task?.progress as ConflictInspectionStage]}
    >
      <GitTransferStatus label="Определяем конфликтующие файлы…" transfer={task?.transfer} />
      {task?.error ? <p className="muted">{task.error}</p> : null}
      {task?.attempt && task.attempt > 1 ? (
        <p className="muted">Повторная загрузка · попытка {task.attempt}</p>
      ) : null}
    </div>
  );
}

export function ProjectConflictProgress({
  projectId,
  ownerId,
  hidden = false,
}: {
  projectId?: string;
  ownerId: string;
  hidden?: boolean;
}) {
  const tasks = useConflictInspections();
  useEffect(() => {
    conflictInspectionStore.setOwner(ownerId);
    return () => conflictInspectionStore.clear();
  }, [ownerId]);
  const pending = tasks.filter(
    (task) => task.projectId === projectId && task.state !== ConflictLoadState.Done,
  );
  if (hidden || !pending.length) return null;
  return (
    <aside className="project-conflict-progress" aria-label="Фоновые проверки конфликтов">
      {pending.map((task) => (
        <section key={`${task.reviewId}:${task.branch}:${task.targetBranch}`}>
          <header>
            <strong>Проверка конфликтов{task.branch ? ` · ${task.branch}` : ""}</strong>
            <Link href={projectChangesHref(task.projectId, { resolve: task.reviewId })}>
              Открыть разрешение конфликтов
            </Link>
          </header>
          {task.state === ConflictLoadState.Failed ? (
            <>
              <p role="alert">{task.error}</p>
              <button
                className="pd-button pd-button--secondary"
                type="button"
                onClick={() => conflictInspectionStore.ensure(task, true)}
              >
                Повторить загрузку
              </button>
            </>
          ) : (
            <InspectionProgress task={task} />
          )}
        </section>
      ))}
    </aside>
  );
}
export function ReviewConflictFiles({
  projectId,
  reviewId,
  branch = "",
  targetBranch = "",
  showProgress = false,
}: {
  projectId: string;
  reviewId: string;
  branch?: string;
  targetBranch?: string;
  showProgress?: boolean;
}) {
  const { inspection, error, retry, loading, task } = useConflictInspection(
    { projectId, reviewId, branch, targetBranch },
    true,
  );
  return (
    <div className="review-conflict-files">
      {showProgress && loading ? <InspectionProgress task={task} /> : null}
      {error ? (
        <>
          <p role="alert">{error}</p>
          {!inspection?.snapshot.files.length ? (
            <button className="pd-button pd-button--secondary" type="button" onClick={retry}>
              Повторить
            </button>
          ) : null}
        </>
      ) : null}
      {!inspection ? null : inspection.snapshot.files.length ? (
        <>
          <p>
            {inspection.snapshot.mediaContentsSkipped
              ? "Предварительный список конфликтов"
              : "Конфликтующие файлы"}
            : {inspection.snapshot.files.length}
          </p>
          <ul>
            {inspection.snapshot.files.map((file) => (
              <li key={file.path}>
                <code>{file.path}</code>
              </li>
            ))}
          </ul>
          {inspection.snapshot.unsupportedReason ? (
            <p>{inspection.snapshot.unsupportedReason}</p>
          ) : null}
          <button
            className="pd-button pd-button--secondary"
            type="button"
            onClick={retry}
            disabled={loading}
            aria-busy={loading}
          >
            {loading ? <LoaderCircle className="spin" size={16} aria-hidden /> : null}
            Обновить список конфликтов
          </button>
        </>
      ) : (
        <p>
          {inspection.snapshot.mediaContentsSkipped
            ? "Пересечений по путям нет. Проверьте возможные переименования медиа в Git-провайдере."
            : "Конфликты больше не обнаружены. Обновите данные МР из Git."}
        </p>
      )}
    </div>
  );
}

type ConflictReviewProps = {
  projectId: string;
  reviewId: string;
  branch: string;
  targetBranch: string;
  ownerId: string;
  canWrite: boolean;
  providerUrl: string;
  reviewLabel: string;
};

function ConflictReviewAction({
  projectId,
  reviewId,
  branch,
  canWrite,
  providerUrl,
  reviewLabel,
}: Pick<
  ConflictReviewProps,
  "projectId" | "reviewId" | "branch" | "canWrite" | "providerUrl" | "reviewLabel"
>) {
  return canWrite ? (
    <Link
      className="pd-button pd-button--primary"
      href={projectChangesHref(projectId, { branch, resolve: reviewId })}
    >
      Разрешить конфликты
    </Link>
  ) : (
    <a
      className="pd-button pd-button--secondary"
      href={providerUrl}
      target="_blank"
      rel="noreferrer"
    >
      Открыть {reviewLabel} в Git-провайдере
    </a>
  );
}

export function BranchConflictNotice({
  projectId,
  reviewId,
  branch,
  targetBranch,
  currentBranch,
  ownerId,
  hasPendingChanges,
  canWrite,
  providerUrl,
  reviewLabel,
}: ConflictReviewProps & { currentBranch: string; hasPendingChanges: boolean }) {
  const localChanges = useLocalDraftChanges(projectId, ownerId, branch, currentBranch);
  const pendingChanges = hasPendingChanges || localChanges;
  return (
    <section
      className="branch-notice branch-conflict-notice"
      aria-label={branchConflictRegionLabel}
    >
      <AlertTriangle aria-hidden size={20} />
      <div>
        <h2>
          {pendingChanges
            ? pendingBranchChangesTitle
            : `${currentBranch === branch ? "Ветка" : `Ветка ${branch}`} конфликтует с ${targetBranch}`}
        </h2>
        {pendingChanges ? (
          <p>
            Сначала разберитесь с текущими правками в {currentBranch}: отправьте их в Git или
            отмените. После этого можно разрешить конфликты.
          </p>
        ) : (
          <p>
            Перед слиянием {reviewLabel} нужно разрешить конфликты между {branch} и {targetBranch}.
          </p>
        )}
        {localChanges ? (
          <p>
            <Link
              href={`/projects/${projectId}/documents?${new URLSearchParams({ branch: currentBranch })}`}
            >
              Открыть документы с локальными правками
            </Link>
          </p>
        ) : null}
        {!pendingChanges ? (
          <ConflictReviewAction
            projectId={projectId}
            reviewId={reviewId}
            branch={branch}
            canWrite={canWrite}
            providerUrl={providerUrl}
            reviewLabel={reviewLabel}
          />
        ) : null}
      </div>
    </section>
  );
}

export function DocumentBranchConflicts({
  canInspect,
  hasPendingChanges,
  ...props
}: ConflictReviewProps & { hasPendingChanges: boolean; canInspect: boolean }) {
  return (
    <section className="document-branch-conflicts" aria-label={branchConflictRegionLabel}>
      <header>
        <h2>
          <AlertTriangle aria-hidden size={18} /> Ветка конфликтует с {props.targetBranch}
        </h2>
        <ConflictReviewAction {...props} />
      </header>
      {hasPendingChanges ? (
        <p>Перед разрешением конфликтов отправьте текущие правки в Git или отмените их.</p>
      ) : null}
      {canInspect ? <ReviewConflictFiles {...props} showProgress /> : null}
    </section>
  );
}

export function BranchConflictResolver(props: ConflictReviewProps & { defaultBranch: string }) {
  return (
    <ConflictResolverContent
      key={JSON.stringify([
        props.ownerId,
        props.projectId,
        props.reviewId,
        props.branch,
        props.targetBranch,
        props.defaultBranch,
      ])}
      {...props}
    />
  );
}

function ConflictResolverContent(props: ConflictReviewProps & { defaultBranch: string }) {
  const { projectId, reviewId, branch, targetBranch, canWrite, providerUrl, reviewLabel } = props;
  const {
    error,
    choices,
    fragments,
    inspectionError,
    retry,
    task,
    loading,
    snapshot,
    policyError,
    choose,
    submit,
    retrySubmission,
    retryCheck,
    phase,
    canEdit,
    canSubmit,
    canStartRebase,
    isRebase,
    startRebase,
    cancelRebase,
  } = useConflictResolution(props);
  return (
    <div className="page branch-conflict-page">
      <header className="page-header">
        <div>
          <h1>Разрешение конфликтов</h1>
          <p>
            <code>{branch}</code> ← <code>{targetBranch}</code>
          </p>
        </div>
        <Link
          className="pd-button pd-button--secondary"
          href={`/projects/${projectId}/reviews?${new URLSearchParams({ review: reviewId })}`}
        >
          Вернуться к {reviewLabel}
        </Link>
      </header>
      {phase === ResolutionPhase.Done ? (
        <section className="empty-state">
          <GitMerge aria-hidden />
          <h2>
            {isRebase ? "Rebase завершён. Результат отправлен в " : "Решение отправлено в "}
            {branch}
          </h2>
          <p>{reviewLabel} обновится после синхронизации с Git.</p>
        </section>
      ) : (
        <>
          {(phase === ResolutionPhase.Checking || phase === ResolutionPhase.Redirecting) &&
          (!task || task.state === ConflictLoadState.Done) ? (
            <GitTransferStatus label="Проверяем состояние ветки…" />
          ) : null}
          {!canWrite ? <p>Для отправки решения нужны права редактора.</p> : null}
          {inspectionError ? (
            <div role="alert">
              <p>{inspectionError}</p>
              <button type="button" onClick={retry}>
                Повторить
              </button>
            </div>
          ) : null}
          {snapshot ? (
            <>
              <p className="muted">
                Стратегия: {snapshot.updatePolicy?.strategy ?? "не определена"}.
              </p>
              {snapshot.rebase ? (
                <section aria-label="Текущий коммит rebase">
                  <h2>
                    Rebase · коммит {snapshot.rebase.index} из {snapshot.rebase.total}
                  </h2>
                  <p>
                    <code>{snapshot.rebase.commitSha.slice(0, 8)}</code> {snapshot.rebase.title}
                  </p>
                  <p>
                    Разрешите конфликт текущего коммита и продолжите перенос. SHA коммитов
                    изменятся; результат отправится в Git после завершения всего rebase.
                  </p>
                </section>
              ) : null}
              <div className="branch-conflict-instructions">
                <strong>
                  {canStartRebase
                    ? "Обновите ветку через rebase"
                    : "Выберите, какой текст сохранить"}
                </strong>
                <p>
                  {canStartRebase ? (
                    `Коммиты ${branch} будут перенесены поверх ${targetBranch}; их SHA изменятся. При конфликте здесь откроется переносимый коммит. Результат отправится в Git после завершения всего rebase.`
                  ) : (
                    <>
                      Выберите текст для каждого спорного фрагмента. Остальные изменения сохранятся
                      автоматически.{" "}
                      {snapshot.rebase
                        ? "Когда всё будет готово, продолжите rebase."
                        : `Когда всё будет готово, отправьте решение в ${branch}.`}
                    </>
                  )}
                </p>
              </div>
              {snapshot.unsupportedReason ? (
                <p role="alert">
                  <AlertTriangle aria-hidden size={16} /> {snapshot.unsupportedReason}
                </p>
              ) : null}
              {policyError ? <p role="alert">{policyError}</p> : null}
              {canStartRebase ? (
                <button
                  type="button"
                  className="pd-button pd-button--primary"
                  onClick={() => void startRebase()}
                >
                  Начать rebase
                </button>
              ) : null}
              {!snapshot.files.length ? (
                <p role="status">
                  {snapshot.mediaContentsSkipped
                    ? "Пересечений по путям нет. Проверьте возможные переименования медиа в Git-провайдере."
                    : `Конфликты больше не обнаружены. Обновите данные ${reviewLabel} из Git.`}
                </p>
              ) : null}
              <fieldset className="branch-conflict-files" disabled={!canEdit}>
                <legend>Конфликтующие файлы: {snapshot.files.length}</legend>
                {snapshot.files.map((file) => (
                  <section className="conflict-card" key={file.path}>
                    <h2>{file.path}</h2>
                    {file.kind === "unsupported" ? (
                      <p>Этот файл нужно обработать в Git-провайдере.</p>
                    ) : (
                      <BranchConflictEditor
                        file={file}
                        branch={snapshot.rebase ? "Актуальная основа" : branch}
                        targetBranch={
                          snapshot.rebase
                            ? `Коммит ${snapshot.rebase.commitSha.slice(0, 8)}`
                            : targetBranch
                        }
                        rebase={Boolean(snapshot.rebase)}
                        value={choices[file.path]}
                        fragments={fragments[file.path]}
                        onChange={(value, nextFragments) => choose(file.path, value, nextFragments)}
                        onRefresh={retry}
                        refreshing={loading}
                      />
                    )}
                  </section>
                ))}
              </fieldset>
              {snapshot.files.length &&
              (snapshot.rebase ||
                snapshot.updatePolicy?.strategy !== BranchUpdateStrategy.Rebase) ? (
                <button
                  className="pd-button pd-button--primary"
                  type="button"
                  disabled={!canSubmit}
                  onClick={() => void submit()}
                >
                  {snapshot.rebase ? "Продолжить rebase" : `Отправить исправления в ${branch}`}
                </button>
              ) : null}
              {snapshot.rebase && phase === ResolutionPhase.Editing && canWrite ? (
                <button
                  className="pd-button pd-button--secondary"
                  type="button"
                  onClick={() => void cancelRebase()}
                >
                  Отменить rebase
                </button>
              ) : null}
            </>
          ) : null}
          {phase === ResolutionPhase.Sending ? (
            <p role="status">
              <LoaderCircle className="spin" aria-hidden size={16} />{" "}
              {isRebase ? "Продолжаем rebase…" : `Отправляем решение в ${branch}…`}
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {phase === ResolutionPhase.CheckFailed ? (
            <button className="pd-button pd-button--secondary" type="button" onClick={retryCheck}>
              Повторить проверку
            </button>
          ) : null}
          {phase === ResolutionPhase.SendFailed || phase === ResolutionPhase.Retrying ? (
            <button
              type="button"
              className="pd-button pd-button--secondary"
              disabled={phase === ResolutionPhase.Retrying || !canWrite}
              onClick={() => void retrySubmission()}
            >
              Проверить и повторить отправку
            </button>
          ) : null}
        </>
      )}
      <p>
        <a href={providerUrl} target="_blank" rel="noreferrer">
          Открыть {reviewLabel} в Git-провайдере
        </a>
      </p>
    </div>
  );
}
