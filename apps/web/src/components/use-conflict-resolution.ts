"use client";

import {
  BranchConflictChoice,
  type BranchConflictSnapshot,
  BranchUpdateStrategy,
  branchUpdateWaitingStatus,
  conflictResolutionPolicyError,
} from "@pushdocs/contracts";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { gitOperationStatusAction } from "@/app/actions";
import {
  cancelRebaseUpdateAction,
  prepareConflictResolutionAction,
  retryConflictResolutionAction,
  submitConflictResolutionAction,
} from "@/app/conflict-actions";
import { projectChangesHref } from "@/lib/project-paths";
import { conflictInspectionStore, useConflictInspection } from "./conflict-inspection";
import { listLocalDrafts } from "./draft-storage";
import { rebaseCancelLabels } from "./git-operation-labels";
import { GitOperationKind, gitOperationKey, gitOperationStore } from "./git-operation-store";
import { branchConflictPollingDelays } from "./git-operation-timing";
import { PollingLifecycle } from "./polling-lifecycle";
import { readProjectBranch, rememberProjectBranch } from "./project-context";
import { useConflictResolutionDrafts } from "./use-conflict-resolution-drafts";

export enum ResolutionPhase {
  Checking = "checking",
  CheckFailed = "check-failed",
  Editing = "editing",
  Submitting = "submitting",
  Redirecting = "redirecting",
  Sending = "sending",
  SendFailed = "send-failed",
  Retrying = "retrying",
  Done = "done",
}

type ResolutionState =
  | { phase: ResolutionPhase.Checking | ResolutionPhase.Redirecting }
  | { phase: ResolutionPhase.Done; rebase: boolean }
  | { phase: ResolutionPhase.CheckFailed; error: string }
  | { phase: ResolutionPhase.Editing; error?: string }
  | { phase: ResolutionPhase.Submitting }
  | {
      phase: ResolutionPhase.Sending | ResolutionPhase.SendFailed | ResolutionPhase.Retrying;
      jobId: string;
      prepared: boolean;
      rebase?: boolean;
      error?: string;
    };

function prepared(state: ResolutionState) {
  return (
    state.phase === ResolutionPhase.Editing ||
    state.phase === ResolutionPhase.Submitting ||
    ("prepared" in state && state.prepared)
  );
}

function matchesBranches(snapshot: BranchConflictSnapshot, branch: string, targetBranch: string) {
  return snapshot.branch === branch && snapshot.sourceBranch === targetBranch;
}

type ResolutionInput = {
  projectId: string;
  reviewId: string;
  branch: string;
  targetBranch: string;
  defaultBranch: string;
  ownerId: string;
  canWrite: boolean;
};

export function useConflictResolution({
  projectId,
  reviewId,
  branch,
  targetBranch,
  defaultBranch,
  ownerId,
  canWrite,
}: ResolutionInput) {
  const router = useRouter();
  const [state, setState] = useState<ResolutionState>({ phase: ResolutionPhase.Checking });
  const [checkAttempt, setCheckAttempt] = useState(0);
  const active = useRef<object | null>(null);
  const commandPending = useRef(false);
  const ready = prepared(state);
  const inspectionState = useConflictInspection(
    { projectId, reviewId, branch, targetBranch },
    ready,
  );
  const { inspection, loading } = inspectionState;
  const isRebase =
    inspection?.snapshot.updatePolicy?.strategy === BranchUpdateStrategy.Rebase ||
    ("rebase" in state && state.rebase === true);
  const snapshot = ready ? inspection?.snapshot : undefined;
  const policyError = snapshot ? conflictResolutionPolicyError(snapshot) : null;
  const drafts = useConflictResolutionDrafts({ projectId, reviewId, ownerId }, inspection);
  const { clear: clearDrafts, choices } = drafts;

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
    (pending: Awaited<ReturnType<typeof check>>) => {
      const blocked = pending.find((item) => item.branch === branch) ?? pending[0];
      if (!blocked) return false;
      setState({ phase: ResolutionPhase.Redirecting });
      router.replace(projectChangesHref(projectId, { branch: blocked.branch, conflict: reviewId }));
      return true;
    },
    [router, projectId, reviewId, branch],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: Retry explicitly reruns the automatic check.
  useEffect(() => {
    const token = {};
    active.current = token;
    commandPending.current = false;
    setState({ phase: ResolutionPhase.Checking });
    void check()
      .then(async (pending) => {
        if (active.current !== token) return;
        const merge = pending.find((item) => item.branch === branch && item.mergeJobId);
        if (merge?.mergeJobId) {
          const job = await gitOperationStatusAction(projectId, merge.mergeJobId);
          if (active.current !== token) return;
          if (job.status === branchUpdateWaitingStatus && job.conflictSnapshot) {
            if (!matchesBranches(job.conflictSnapshot, branch, targetBranch)) {
              returnToChanges(pending);
              return;
            }
            const blocked = pending.filter(
              (item) => item.paths.length || item.mergeJobId !== merge.mergeJobId,
            );
            if (returnToChanges(blocked)) return;
            conflictInspectionStore.acceptRebase(
              { projectId, reviewId, branch, targetBranch },
              merge.mergeJobId,
              job.conflictSnapshot,
            );
            setState({ phase: ResolutionPhase.Editing });
            return;
          }
          setState({
            phase: merge.mergeFailed ? ResolutionPhase.SendFailed : ResolutionPhase.Sending,
            jobId: merge.mergeJobId,
            prepared: false,
            rebase: Boolean(job.conflictSnapshot?.rebase),
          });
        } else if (!returnToChanges(pending)) {
          if (
            conflictInspectionStore
              .getSnapshot()
              .some(
                (task) =>
                  task.projectId === projectId &&
                  task.reviewId === reviewId &&
                  task.inspection?.snapshot.rebase,
              )
          )
            conflictInspectionStore.invalidate(projectId, reviewId);
          rememberProjectBranch(projectId, branch);
          setState({ phase: ResolutionPhase.Editing });
        }
      })
      .catch((error) => {
        if (active.current === token)
          setState({
            phase: ResolutionPhase.CheckFailed,
            error: error instanceof Error ? error.message : "Не удалось проверить состояние веток.",
          });
      });
    return () => {
      active.current = null;
    };
  }, [check, returnToChanges, projectId, branch, checkAttempt]);

  const jobId = "jobId" in state ? state.jobId : undefined;
  const sending = state.phase === ResolutionPhase.Sending;
  useEffect(() => {
    if (!sending || !jobId) return;
    const poller = new PollingLifecycle({
      request: () => gitOperationStatusAction(projectId, jobId),
      onResult: (job) => {
        if (job.status === branchUpdateWaitingStatus && job.conflictSnapshot) {
          if (!matchesBranches(job.conflictSnapshot, branch, targetBranch)) {
            setState({ phase: ResolutionPhase.Redirecting });
            router.replace(projectChangesHref(projectId, branch));
            return false;
          }
          conflictInspectionStore.acceptRebase(
            { projectId, reviewId, branch, targetBranch },
            jobId,
            job.conflictSnapshot,
          );
          setState({ phase: ResolutionPhase.Editing });
          return false;
        }
        if (job.status === "failed") {
          setState((current) =>
            current.phase === ResolutionPhase.Sending
              ? {
                  ...current,
                  phase: ResolutionPhase.SendFailed,
                  error: job.last_error || "Отправка остановлена.",
                }
              : current,
          );
          return false;
        }
        if (job.status === "done") {
          conflictInspectionStore.invalidate(projectId, reviewId);
          clearDrafts();
          if (isRebase) {
            const key = gitOperationKey(projectId, branch, GitOperationKind.UpdateBranch);
            const task = gitOperationStore.getSnapshot(key);
            if (task?.jobId === jobId) gitOperationStore.acknowledge(key, task);
            setState({ phase: ResolutionPhase.Redirecting });
            router.replace(projectChangesHref(projectId, branch));
          } else setState({ phase: ResolutionPhase.Done, rebase: false });
          router.refresh();
          return false;
        }
        return true;
      },
      onError: () => {
        setState((current) =>
          current.phase === ResolutionPhase.Sending
            ? { ...current, error: "Нет связи с сервером. Проверяем результат отправки…" }
            : current,
        );
        return true;
      },
      delays: branchConflictPollingDelays,
    });
    poller.start();
    return () => poller.dispose();
  }, [sending, jobId, projectId, reviewId, branch, targetBranch, clearDrafts, isRebase, router]);

  const needsRebaseUpdate = Boolean(
    snapshot?.updatePolicy?.strategy === BranchUpdateStrategy.Rebase &&
      !snapshot.updatePolicy.error &&
      !snapshot.rebase,
  );
  useEffect(() => {
    if (state.phase !== ResolutionPhase.Editing || loading || !needsRebaseUpdate) return;
    setState({ phase: ResolutionPhase.Redirecting });
    router.replace(projectChangesHref(projectId, branch));
  }, [state.phase, loading, needsRebaseUpdate, router, projectId, branch]);

  const complete = snapshot?.files.every(
    (file) =>
      choices[file.path]?.choice &&
      (choices[file.path]?.choice !== BranchConflictChoice.Manual ||
        choices[file.path]?.content !== undefined),
  );

  const canEdit =
    state.phase === ResolutionPhase.Editing && !loading && canWrite && !policyError && drafts.ready;
  const canSubmit = Boolean(
    canEdit &&
      inspection &&
      complete &&
      !snapshot?.unsupportedReason &&
      !snapshot?.files.some((file) => file.kind === "unsupported"),
  );

  async function submit() {
    const token = active.current;
    if (!token || commandPending.current || !canSubmit || !inspection) return;
    commandPending.current = true;
    setState({ phase: ResolutionPhase.Submitting });
    try {
      const pending = await check();
      const blocked =
        snapshot?.rebase || snapshot?.merge
          ? pending.filter(
              (item) =>
                item.paths.length || item.mergeJobId !== inspection.id || item.branch !== branch,
            )
          : pending;
      if (active.current !== token || returnToChanges(blocked)) return;
      const id = await submitConflictResolutionAction(
        projectId,
        inspection.id,
        inspection.snapshot.files.map((file) => choices[file.path]),
        ...(inspection.snapshot.rebase
          ? ([inspection.snapshot.rebase.conflictId] as const)
          : inspection.snapshot.merge
            ? ([undefined, inspection.snapshot.merge.conflictId] as const)
            : ([] as const)),
      );
      if (active.current === token) {
        if (snapshot?.rebase) clearDrafts();
        setState({ phase: ResolutionPhase.Sending, jobId: id, prepared: true });
      }
    } catch (error) {
      if (active.current === token)
        setState({
          phase: ResolutionPhase.Editing,
          error: error instanceof Error ? error.message : "Не удалось начать отправку.",
        });
    } finally {
      if (active.current === token) commandPending.current = false;
    }
  }

  async function cancelRebase() {
    const token = active.current;
    if (
      !token ||
      commandPending.current ||
      (!snapshot?.rebase && !snapshot?.merge) ||
      !canWrite ||
      state.phase !== ResolutionPhase.Editing
    )
      return;
    commandPending.current = true;
    setState({ phase: ResolutionPhase.Submitting });
    try {
      const conflict = snapshot.rebase ?? snapshot.merge;
      if (!conflict) return;
      await cancelRebaseUpdateAction(projectId, conflict.operationId, conflict.conflictId);
      if (active.current !== token) return;
      clearDrafts();
      conflictInspectionStore.invalidate(projectId, reviewId);
      setState({ phase: ResolutionPhase.Redirecting });
      router.push(projectChangesHref(projectId, branch));
      router.refresh();
    } catch (error) {
      if (active.current === token)
        setState({
          phase: ResolutionPhase.Editing,
          error: error instanceof Error ? error.message : rebaseCancelLabels.error,
        });
    } finally {
      if (active.current === token) commandPending.current = false;
    }
  }

  async function retrySubmission() {
    const token = active.current;
    if (!token || commandPending.current || state.phase !== ResolutionPhase.SendFailed || !canWrite)
      return;
    commandPending.current = true;
    setState({ ...state, phase: ResolutionPhase.Retrying });
    try {
      await retryConflictResolutionAction(projectId, state.jobId);
      if (active.current === token)
        setState({ ...state, phase: ResolutionPhase.Sending, error: undefined });
    } catch {
      if (active.current === token) setCheckAttempt((attempt) => attempt + 1);
    } finally {
      if (active.current === token) commandPending.current = false;
    }
  }

  return {
    task: inspectionState.task,
    loading,
    inspectionError: inspectionState.error,
    retry: inspectionState.retry,
    choices: drafts.choices,
    fragments: drafts.fragments,
    choose: drafts.choose,
    snapshot: needsRebaseUpdate ? undefined : snapshot,
    updateStrategy: inspection?.snapshot.updatePolicy?.strategy,
    policyError: needsRebaseUpdate ? null : policyError,
    phase: state.phase,
    canEdit,
    canSubmit,
    isRebase: state.phase === ResolutionPhase.Done ? state.rebase : isRebase,
    cancelRebase,
    error: "error" in state ? (state.error ?? "") : "",
    submit,
    retrySubmission,
    retryCheck: () => setCheckAttempt((attempt) => attempt + 1),
  };
}
