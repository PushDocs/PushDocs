"use client";

import {
  type BranchConflictSnapshot,
  branchConflictCache,
  branchConflictLimits,
  branchUpdateWaitingStatus,
  type GitTransferProgress,
} from "@pushdocs/contracts";
import { useEffect, useSyncExternalStore } from "react";
import { gitOperationStatusAction } from "@/app/actions";
import { inspectReviewConflictsAction } from "@/app/conflict-actions";
import { branchConflictPollingDelays } from "./git-operation-timing";
import { PollingLifecycle } from "./polling-lifecycle";

export enum ConflictLoadState {
  Starting = "starting",
  Running = "running",
  Done = "done",
  Failed = "failed",
}

export type ConflictInspectionRequest = {
  projectId: string;
  /** Review ID or a namespaced reference to a branch update operation. */
  reviewId: string;
  branch: string;
  targetBranch: string;
};

export type ConflictInspectionTask = ConflictInspectionRequest & {
  state: ConflictLoadState;
  jobId?: string;
  inspection?: { id: string; snapshot: BranchConflictSnapshot };
  progress?: string | null;
  counts?: { completed: number; total: number } | null;
  transfer?: GitTransferProgress;
  error?: string;
  updatedAt: number;
  attempt?: number;
};

type Entry = {
  task: ConflictInspectionTask;
  poller?: PollingLifecycle<Awaited<ReturnType<typeof gitOperationStatusAction>>>;
};
class InspectionFailure extends Error {}
const emptyTasks: ConflictInspectionTask[] = [];
const serverSnapshot = () => emptyTasks;
const inspectionKey = (request: ConflictInspectionRequest) =>
  JSON.stringify([request.projectId, request.reviewId, request.branch, request.targetBranch]);

class ConflictInspectionStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private tasks: ConflictInspectionTask[] = emptyTasks;
  private ownerId?: string;

  setOwner(ownerId: string) {
    if (this.ownerId && this.ownerId !== ownerId) this.clear();
    this.ownerId = ownerId;
  }

  getSnapshot = () => this.tasks;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private notify() {
    this.tasks = [...this.entries.values()].map((entry) => entry.task);
    for (const listener of this.listeners) listener();
  }

  ensure(request: ConflictInspectionRequest, retry = false) {
    const key = inspectionKey(request);
    const previous = this.entries.get(key);
    if (
      previous &&
      (previous.task.state === ConflictLoadState.Starting ||
        previous.task.state === ConflictLoadState.Running)
    )
      return;
    if (
      !retry &&
      previous &&
      (previous.task.state === ConflictLoadState.Failed ||
        Date.now() - previous.task.updatedAt < branchConflictLimits.clientCacheMs)
    )
      return;
    previous?.poller?.dispose();
    for (const [oldKey, entry] of this.entries) {
      if (this.entries.size < branchConflictCache.entries) break;
      if (
        entry.task.state === ConflictLoadState.Done ||
        entry.task.state === ConflictLoadState.Failed
      ) {
        entry.poller?.dispose();
        this.entries.delete(oldKey);
      }
    }
    const entry: Entry = {
      task: {
        ...request,
        state: ConflictLoadState.Starting,
        inspection: previous?.task.inspection,
        updatedAt: Date.now(),
      },
    };
    this.entries.set(key, entry);
    this.notify();
    void inspectReviewConflictsAction(request.projectId, request.reviewId, retry)
      .then((jobId) => {
        if (this.entries.get(key) !== entry) return;
        entry.task = { ...entry.task, jobId, state: ConflictLoadState.Running };
        this.notify();
        this.poll(entry, jobId);
      })
      .catch((error) => {
        if (this.entries.get(key) !== entry) return;
        entry.task = {
          ...entry.task,
          state: ConflictLoadState.Failed,
          error: error instanceof Error ? error.message : "Не удалось получить конфликты.",
        };
        this.notify();
      });
  }

  private poll(entry: Entry, jobId: string) {
    entry.poller = new PollingLifecycle({
      request: () => gitOperationStatusAction(entry.task.projectId, jobId),
      onResult: (job) => {
        if (job.status === "failed")
          throw new InspectionFailure(job.last_error || "Не удалось получить конфликты.");
        if (
          (job.status === "done" || job.status === branchUpdateWaitingStatus) &&
          !job.conflictSnapshot
        )
          throw new InspectionFailure("Список конфликтов недоступен.");
        entry.task = {
          ...entry.task,
          state:
            job.status === "done" || job.status === branchUpdateWaitingStatus
              ? ConflictLoadState.Done
              : ConflictLoadState.Running,
          progress: job.progress,
          attempt: job.progressAttempt,
          counts: job.progressCounts,
          transfer: job.transferProgress,
          inspection: job.conflictSnapshot
            ? { id: jobId, snapshot: job.conflictSnapshot }
            : entry.task.inspection,
          error: undefined,
          updatedAt: Date.now(),
        };
        this.notify();
        return entry.task.state === ConflictLoadState.Running;
      },
      onError: (error) => {
        entry.task = {
          ...entry.task,
          state:
            error instanceof InspectionFailure
              ? ConflictLoadState.Failed
              : ConflictLoadState.Running,
          error:
            error instanceof InspectionFailure
              ? error.message
              : "Нет связи с сервером. Проверяем загрузку…",
        };
        this.notify();
        return entry.task.state === ConflictLoadState.Running;
      },
      delays: branchConflictPollingDelays,
    });
    entry.poller.start();
  }

  acceptRebase(
    request: ConflictInspectionRequest,
    jobId: string,
    snapshot: BranchConflictSnapshot,
  ) {
    const key = inspectionKey(request);
    this.entries.get(key)?.poller?.dispose();
    this.entries.set(key, {
      task: {
        ...request,
        jobId,
        inspection: { id: jobId, snapshot },
        state: ConflictLoadState.Done,
        updatedAt: Date.now(),
      },
    });
    this.notify();
  }

  invalidate(projectId: string, reviewId: string) {
    for (const [key, entry] of this.entries) {
      if (entry.task.projectId === projectId && entry.task.reviewId === reviewId) {
        entry.poller?.dispose();
        this.entries.delete(key);
      }
    }
    this.notify();
  }

  clear() {
    for (const entry of this.entries.values()) entry.poller?.dispose();
    this.entries.clear();
    this.notify();
  }
}

export const conflictInspectionStore = new ConflictInspectionStore();

export function useConflictInspections() {
  return useSyncExternalStore(
    conflictInspectionStore.subscribe,
    conflictInspectionStore.getSnapshot,
    serverSnapshot,
  );
}

export function useConflictInspection(request: ConflictInspectionRequest, active: boolean) {
  const { projectId, reviewId, branch, targetBranch } = request;
  const tasks = useConflictInspections();
  const task = tasks.find((item) => inspectionKey(item) === inspectionKey(request));
  useEffect(() => {
    if (active) conflictInspectionStore.ensure({ projectId, reviewId, branch, targetBranch });
  }, [active, projectId, reviewId, branch, targetBranch]);
  return {
    task,
    inspection: task?.inspection,
    loading:
      task?.state === ConflictLoadState.Starting || task?.state === ConflictLoadState.Running,
    error:
      task?.state === ConflictLoadState.Failed
        ? (task.error ?? "Не удалось получить конфликты.")
        : "",
    retry: () => conflictInspectionStore.ensure(request, true),
  };
}
