"use client";

import type { GitTransferProgress } from "@pushdocs/contracts";
import { useEffect, useSyncExternalStore } from "react";
import { gitOperationStatusAction, synchronizeBranchAction } from "@/app/actions";
import { gitOperationPollingDelays } from "./git-operation-timing";

export enum BranchImportState {
  Starting = "starting",
  Queued = "queued",
  Running = "running",
  Done = "done",
  Failed = "failed",
}

type BranchImportRequest = { projectId: string; branch: string };
export type BranchImportTask = BranchImportRequest & {
  state: BranchImportState;
  jobId?: string;
  transfer?: GitTransferProgress;
  error?: string;
  notice?: string;
  updatedAt: number;
};
type Entry = { task: BranchImportTask; timer?: ReturnType<typeof setTimeout> };
const cache = { entries: 20, completedMs: 60_000 } as const;
const emptyTasks: BranchImportTask[] = [];
const serverSnapshot = () => emptyTasks;
const importKey = ({ projectId, branch }: BranchImportRequest) =>
  JSON.stringify([projectId, branch]);

function branchImportError(branch: string, lastError?: string | null): string {
  if (lastError === `Branch ${branch} was not found`)
    return `Ветка ${branch} не найдена в подключённом репозитории. Возможно, она удалена или находится в форке. Откройте PR / MR и проверьте исходный репозиторий.`;
  if (lastError?.startsWith("Provider request failed with 401:"))
    return "Не удалось загрузить ветку: токен доступа к репозиторию недействителен или отозван. Обновите access token в «Настройки → Подключения», затем повторите загрузку.";
  return "Не удалось загрузить ветку. Проверьте доступ подключения PushDocs к репозиторию и повторите попытку.";
}

class BranchImportStore {
  private entries = new Map<string, Entry>();
  private listeners = new Set<() => void>();
  private tasks = emptyTasks;
  private ownerId?: string;
  private connection?: object;
  private cleanupTimer?: ReturnType<typeof setTimeout>;

  getSnapshot = () => this.tasks;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  connect(ownerId: string) {
    clearTimeout(this.cleanupTimer);
    if (this.ownerId && this.ownerId !== ownerId) this.clear();
    this.ownerId = ownerId;
    const connection = {};
    this.connection = connection;
    return () => {
      this.cleanupTimer = setTimeout(() => {
        if (this.connection === connection) this.clear();
      }, 0);
    };
  }

  private notify() {
    this.tasks = [...this.entries.values()].map((entry) => entry.task);
    for (const listener of this.listeners) listener();
  }

  ensure(request: BranchImportRequest, retry = false) {
    const key = importKey(request);
    const previous = this.entries.get(key);
    if (previous) {
      const { state, updatedAt } = previous.task;
      if (state !== BranchImportState.Done && (state !== BranchImportState.Failed || !retry))
        return;
      if (!retry && Date.now() - updatedAt < cache.completedMs) return;
    }
    clearTimeout(previous?.timer);
    for (const [oldKey, entry] of this.entries) {
      if (this.entries.size < cache.entries) break;
      if (
        entry.task.state === BranchImportState.Done ||
        entry.task.state === BranchImportState.Failed
      )
        this.entries.delete(oldKey);
    }
    const entry: Entry = {
      task: {
        projectId: request.projectId,
        branch: request.branch,
        state: BranchImportState.Starting,
        updatedAt: Date.now(),
      },
    };
    this.entries.set(key, entry);
    this.notify();
    const data = new FormData();
    data.set("projectId", request.projectId);
    data.set("branch", request.branch);
    void synchronizeBranchAction(data)
      .then((jobId) => {
        if (this.entries.get(key) !== entry) return;
        entry.task = {
          ...entry.task,
          state: jobId ? BranchImportState.Queued : BranchImportState.Done,
          jobId: jobId ?? undefined,
          updatedAt: Date.now(),
        };
        this.notify();
        if (jobId) void this.poll(key, entry);
      })
      .catch(() => {
        if (this.entries.get(key) !== entry) return;
        entry.task = {
          ...entry.task,
          state: BranchImportState.Failed,
          error: "Не удалось загрузить ветку. Проверьте подключение и повторите попытку.",
          updatedAt: Date.now(),
        };
        this.notify();
      });
  }

  private async poll(key: string, entry: Entry) {
    const { projectId, jobId, branch } = entry.task;
    if (!jobId) return;
    let delay: number = gitOperationPollingDelays.normal;
    try {
      const job = await gitOperationStatusAction(projectId, jobId);
      if (this.entries.get(key) !== entry) return;
      entry.task = {
        ...entry.task,
        state: job.status as BranchImportState,
        transfer:
          job.status === "queued" ? undefined : (job.transferProgress ?? entry.task.transfer),
        error: job.status === "failed" ? branchImportError(branch, job.last_error) : undefined,
        notice: undefined,
        updatedAt: Date.now(),
      };
    } catch {
      if (this.entries.get(key) !== entry) return;
      entry.task = { ...entry.task, notice: "Нет связи с сервером. Проверяем загрузку…" };
      delay = gitOperationPollingDelays.retry;
    }
    this.notify();
    if (
      this.entries.get(key) === entry &&
      (entry.task.state === BranchImportState.Queued ||
        entry.task.state === BranchImportState.Running)
    )
      entry.timer = setTimeout(() => void this.poll(key, entry), delay);
  }

  clear() {
    clearTimeout(this.cleanupTimer);
    this.connection = undefined;
    this.ownerId = undefined;
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
    this.notify();
  }
}

export const branchImportStore = new BranchImportStore();

export function useBranchImports() {
  return useSyncExternalStore(
    branchImportStore.subscribe,
    branchImportStore.getSnapshot,
    serverSnapshot,
  );
}

export function useBranchImport(projectId: string, branch: string) {
  const tasks = useBranchImports();
  const task = tasks.find((item) => item.projectId === projectId && item.branch === branch);
  useEffect(() => {
    if (!task || task.state === BranchImportState.Done)
      branchImportStore.ensure({ projectId, branch });
  }, [projectId, branch, task]);
  return task;
}
