"use client";

import {
  BranchConflictChoice,
  type BranchConflictResolution,
  branchConflictLimits,
  ConflictInspectionStage,
} from "@pushdocs/contracts";
import { AlertTriangle, GitMerge, LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { gitOperationStatusAction } from "@/app/actions";
import {
  prepareConflictResolutionAction,
  retryConflictResolutionAction,
  submitConflictResolutionAction,
} from "@/app/conflict-actions";
import { BranchConflictEditor, type ConflictDrafts } from "./branch-conflict-editor";
import {
  type ConflictInspectionTask,
  ConflictLoadState,
  conflictInspectionStore,
  useConflictInspection,
  useConflictInspections,
} from "./conflict-inspection";
import { listLocalDrafts } from "./draft-storage";
import { pendingBranchChangesTitle } from "./git-operation-labels";
import { GitTransferStatus } from "./git-transfer-status";
import { readProjectBranch, rememberProjectBranch } from "./project-context";
import { useLocalDraftChanges } from "./use-local-draft-changes";

const inspectionStages: Record<ConflictInspectionStage, string> = {
  [ConflictInspectionStage.Preparing]: "Подключаемся к Git…",
  [ConflictInspectionStage.Fetching]: "Загружаем данные веток…",
  [ConflictInspectionStage.Comparing]: "Сравниваем ветки и получаем нужные файлы…",
  [ConflictInspectionStage.Reading]: "Загружаем версии конфликтующих файлов…",
  [ConflictInspectionStage.Finalizing]: "Готовим список конфликтов…",
};
const fragmentDraftVersion = 1;
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
            <Link
              href={`/projects/${task.projectId}/changes?${new URLSearchParams({ resolve: task.reviewId })}`}
            >
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
type Blocker = {
  branch: string;
  paths: string[];
  busy: boolean;
  mergeJobId?: string;
  mergeFailed?: boolean;
};

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
      href={`/projects/${projectId}/changes?${new URLSearchParams({ branch, resolve: reviewId })}`}
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

export function BranchConflictResolver({
  projectId,
  reviewId,
  branch,
  targetBranch,
  defaultBranch,
  ownerId,
  canWrite,
  providerUrl,
  reviewLabel,
}: ConflictReviewProps & { defaultBranch: string }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checkAttempt, setCheckAttempt] = useState(0);
  const [error, setError] = useState("");
  const [jobId, setJobId] = useState<string>();
  const [jobFailed, setJobFailed] = useState(false);
  const [done, setDone] = useState(false);
  const [choices, setChoices] = useState<Record<string, BranchConflictResolution[number]>>({});
  const [fragments, setFragments] = useState<ConflictDrafts>({});
  const {
    inspection,
    error: inspectionError,
    retry,
    task,
    loading,
  } = useConflictInspection({ projectId, reviewId, branch, targetBranch }, ready);
  const currentInspection = useRef<string>(undefined);
  const snapshot = ready ? inspection?.snapshot : undefined;
  const storageKey = `pushdocs:merge-resolution:${JSON.stringify([ownerId, projectId, reviewId])}`;

  useEffect(() => {
    if (!inspection || currentInspection.current === inspection.id) return;
    currentInspection.current = inspection.id;
    let saved = {};
    let savedFragments = {};
    try {
      const cached = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      if (
        cached?.parentSha === inspection.snapshot.parentSha &&
        cached?.sourceSha === inspection.snapshot.sourceSha
      ) {
        saved = cached.choices;
        if (cached.fragmentDraftVersion === fragmentDraftVersion) savedFragments = cached.fragments;
      }
    } catch {
      /* Optional browser storage. */
    }
    setChoices(saved || {});
    setFragments(savedFragments || {});
  }, [inspection, storageKey]);

  function choose(
    path: string,
    value: BranchConflictResolution[number] | undefined,
    fileFragments?: ConflictDrafts[string],
  ) {
    const next = { ...choices };
    if (value) next[path] = value;
    else delete next[path];
    const nextFragments = { ...fragments };
    if (fileFragments) nextFragments[path] = fileFragments;
    else delete nextFragments[path];
    setChoices(next);
    setFragments(nextFragments);
    try {
      localStorage.setItem(
        storageKey,
        JSON.stringify({
          parentSha: snapshot?.parentSha,
          sourceSha: snapshot?.sourceSha,
          choices: next,
          fragments: nextFragments,
          fragmentDraftVersion,
        }),
      );
    } catch {
      /* The visible result remains available for submission. */
    }
  }

  useEffect(() => {
    if (!jobId || jobFailed) return;
    const operationId = jobId;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const job = await gitOperationStatusAction(projectId, operationId);
        if (cancelled) return;
        if (job.status === "failed") {
          setJobFailed(true);
          setError(job.last_error || "Отправка остановлена.");
        } else if (job.status === "done") {
          setDone(true);
          conflictInspectionStore.invalidate(projectId, reviewId);
          setError("");
          try {
            localStorage.removeItem(storageKey);
          } catch {
            /* Optional browser storage. */
          }
        } else timer = setTimeout(() => void poll(), branchConflictLimits.pollMs);
      } catch {
        if (!cancelled) {
          setError("Нет связи с сервером. Проверяем результат отправки…");
          timer = setTimeout(() => void poll(), branchConflictLimits.pollMs);
        }
      }
    }
    void poll();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [jobId, jobFailed, projectId, reviewId, storageKey]);

  const check = useCallback(async () => {
    const current = readProjectBranch(projectId, defaultBranch);
    const pending = await prepareConflictResolutionAction(projectId, reviewId, current);
    for (const local of listLocalDrafts(projectId, [current, branch], ownerId)) {
      let item = pending.find((item) => item.branch === local.branch);
      if (!item) {
        item = {
          branch: local.branch,
          paths: [],
          busy: false,
          mergeJobId: undefined,
          mergeFailed: false,
        };
        pending.push(item);
      }
      if (!item.paths.includes(local.path)) item.paths.push(local.path);
    }
    return pending.filter((item) => item.paths.length || item.busy);
  }, [projectId, reviewId, branch, defaultBranch, ownerId]);

  const returnToChanges = useCallback(
    (pending: Blocker[]) => {
      const blocked = pending.find((item) => item.branch === branch) ?? pending[0];
      if (!blocked) return false;
      router.replace(
        `/projects/${projectId}/changes?${new URLSearchParams({ branch: blocked.branch, conflict: reviewId })}`,
      );
      return true;
    },
    [router, projectId, reviewId, branch],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reruns the automatic check.
  useEffect(() => {
    let active = true;
    setChecking(true);
    setError("");
    void check()
      .then((pending) => {
        if (!active) return;
        const merge = pending.find((item) => item.branch === branch && item.mergeJobId);
        if (merge?.mergeJobId) {
          setJobId(merge.mergeJobId);
          setJobFailed(Boolean(merge.mergeFailed));
        } else if (!returnToChanges(pending)) {
          rememberProjectBranch(projectId, branch);
          setReady(true);
        }
      })
      .catch((error) => {
        if (active)
          setError(
            error instanceof Error ? error.message : "Не удалось проверить состояние веток.",
          );
      })
      .finally(() => {
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [check, returnToChanges, projectId, branch, checkAttempt]);

  async function submit() {
    if (!inspection || loading || checking || jobId) return;
    setChecking(true);
    setError("");
    try {
      const pending = await check();
      if (returnToChanges(pending)) return;
      const id = await submitConflictResolutionAction(
        projectId,
        inspection.id,
        inspection.snapshot.files.map((file) => choices[file.path]),
      );
      setJobId(id);
    } catch (error) {
      setError(error instanceof Error ? error.message : "Не удалось начать отправку.");
    } finally {
      setChecking(false);
    }
  }

  const complete = snapshot?.files.every(
    (file) =>
      choices[file.path]?.choice &&
      (choices[file.path]?.choice !== BranchConflictChoice.Manual ||
        choices[file.path]?.content !== undefined),
  );
  const sending = Boolean(jobId && !jobFailed && !done);
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
      {done ? (
        <section className="empty-state">
          <GitMerge aria-hidden />
          <h2>Решение отправлено в {branch}</h2>
          <p>{reviewLabel} обновится после синхронизации с Git.</p>
        </section>
      ) : (
        <>
          {!ready && !jobId && !error && (!task || task.state === ConflictLoadState.Done) ? (
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
              <div className="branch-conflict-instructions">
                <strong>Выберите, какой текст сохранить</strong>
                <p>
                  Выберите текст для каждого спорного фрагмента. Остальные изменения сохранятся
                  автоматически. Когда всё будет готово, отправьте решение в {branch}.
                </p>
              </div>
              {snapshot.unsupportedReason ? (
                <p role="alert">
                  <AlertTriangle aria-hidden size={16} /> {snapshot.unsupportedReason}
                </p>
              ) : null}
              {!snapshot.files.length ? (
                <p role="status">
                  {snapshot.mediaContentsSkipped
                    ? "Пересечений по путям нет. Проверьте возможные переименования медиа в Git-провайдере."
                    : `Конфликты больше не обнаружены. Обновите данные ${reviewLabel} из Git.`}
                </p>
              ) : null}
              <fieldset
                className="branch-conflict-files"
                disabled={loading || sending || checking || Boolean(jobId) || !canWrite}
              >
                <legend>Конфликтующие файлы: {snapshot.files.length}</legend>
                {snapshot.files.map((file) => (
                  <section className="conflict-card" key={file.path}>
                    <h2>{file.path}</h2>
                    {file.kind === "unsupported" ? (
                      <p>Этот файл нужно обработать в Git-провайдере.</p>
                    ) : (
                      <BranchConflictEditor
                        file={file}
                        branch={branch}
                        targetBranch={targetBranch}
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
              {snapshot.files.length ? (
                <button
                  className="pd-button pd-button--primary"
                  type="button"
                  disabled={
                    !complete ||
                    Boolean(snapshot.unsupportedReason) ||
                    snapshot.files.some((file) => file.kind === "unsupported") ||
                    loading ||
                    checking ||
                    Boolean(jobId) ||
                    !canWrite
                  }
                  onClick={() => void submit()}
                >
                  Отправить исправления в {branch}
                </button>
              ) : null}
            </>
          ) : null}
          {sending ? (
            <p role="status">
              <LoaderCircle className="spin" aria-hidden size={16} /> Отправляем решение в {branch}…
            </p>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
          {!ready && !jobId && error ? (
            <button
              className="pd-button pd-button--secondary"
              type="button"
              disabled={checking}
              onClick={() => setCheckAttempt((value) => value + 1)}
            >
              Повторить проверку
            </button>
          ) : null}
          {jobFailed ? (
            <button
              type="button"
              className="pd-button pd-button--secondary"
              disabled={checking || !canWrite}
              onClick={async () => {
                setChecking(true);
                try {
                  if (!jobId) return;
                  await retryConflictResolutionAction(projectId, jobId);
                  setJobFailed(false);
                  setError("");
                } catch (error) {
                  setError(
                    error instanceof Error ? error.message : "Не удалось повторить отправку.",
                  );
                  setJobId(undefined);
                  setJobFailed(false);
                  setReady(false);
                  setCheckAttempt((value) => value + 1);
                } finally {
                  setChecking(false);
                }
              }}
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
