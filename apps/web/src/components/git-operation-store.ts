import { branchUpdateWaitingStatus } from "@pushdocs/contracts";
import { gitOperationStatusAction, startGitOperationAction } from "@/app/actions";
import { gitOperationPollingDelays } from "./git-operation-timing";
import { PollingLifecycle } from "./polling-lifecycle";

export enum GitOperationKind {
  Pull = "pull",
  Merge = "merge",
  Reviews = "reviews",
  CreateReview = "create-review",
  UpdateBranch = "update-branch",
}

export type GitOperationTask = {
  kind: GitOperationKind;
  phase: "preparing" | "running" | "done" | "failed" | typeof branchUpdateWaitingStatus;
  jobId?: string;
  message?: string;
};

type Entry = {
  task: GitOperationTask | null;
  listeners: Set<() => void>;
  poller?: PollingLifecycle<Awaited<ReturnType<typeof gitOperationStatusAction>>>;
};

export function gitOperationKey(projectId: string, branch: string, kind: GitOperationKind) {
  return JSON.stringify([
    projectId,
    kind === GitOperationKind.Reviews || kind === GitOperationKind.CreateReview ? kind : "branch",
    kind === GitOperationKind.Reviews ? null : branch,
  ]);
}

class GitOperationStore {
  private entries = new Map<string, Entry>();

  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { task: null, listeners: new Set() };
      this.entries.set(key, entry);
    }
    return entry;
  }

  getSnapshot(key: string) {
    return this.entries.get(key)?.task ?? null;
  }

  subscribe(key: string, projectId: string, listener: () => void) {
    const entry = this.entry(key);
    entry.listeners.add(listener);
    if (entry.task?.phase === branchUpdateWaitingStatus) {
      entry.poller?.dispose();
      entry.poller = undefined;
      this.update(entry, { ...entry.task, phase: "running" });
    }
    this.poll(projectId, entry);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) entry.poller?.pause();
    };
  }

  private update(entry: Entry, task: GitOperationTask | null) {
    entry.task = task;
    for (const listener of entry.listeners) listener();
  }

  async start(
    key: string,
    kind: GitOperationKind,
    input: Parameters<typeof startGitOperationAction>[0],
    beforeStart?: () => Promise<boolean>,
  ) {
    const entry = this.entry(key);
    if (entry.task && entry.task.phase !== "failed") return;
    entry.poller?.dispose();
    entry.poller = undefined;
    const task: GitOperationTask = { kind, phase: "preparing" };
    this.update(entry, task);
    try {
      const saved = !beforeStart || (await beforeStart());
      if (this.entries.get(key) !== entry || entry.task !== task) return;
      if (!saved) {
        this.update(entry, {
          kind,
          phase: "failed",
          message: "Сначала сохраните изменения в редакторе.",
        });
        return;
      }
      const running: GitOperationTask = { kind, phase: "running" };
      this.update(entry, running);
      const result = await startGitOperationAction(input);
      if (this.entries.get(key) !== entry || entry.task !== running) return;
      if (typeof result !== "string") {
        this.update(entry, { kind, phase: "failed", message: result.error });
        return;
      }
      const jobId = result;
      this.update(entry, { ...running, jobId });
      this.poll(input.projectId, entry);
    } catch {
      if (this.entries.get(key) !== entry) return;
      this.update(entry, {
        kind,
        phase: "failed",
        message: "Не удалось начать операцию. Повторите попытку.",
      });
    }
  }

  private poll(projectId: string, entry: Entry) {
    const task = entry.task;
    if (task?.phase !== "running" || !task.jobId) return;
    if (!entry.poller) {
      const jobId = task.jobId;
      entry.poller = new PollingLifecycle({
        request: () => gitOperationStatusAction(projectId, jobId),
        onResult: (result) => {
          if (
            result.status !== "done" &&
            result.status !== "failed" &&
            result.status !== branchUpdateWaitingStatus
          )
            return true;
          this.update(entry, {
            ...task,
            phase: result.status,
            message:
              result.status === branchUpdateWaitingStatus
                ? "Rebase остановлен. Разрешите конфликт текущего коммита."
                : result.status === "failed"
                  ? result.last_error || "Операция не завершена. Повторите попытку."
                  : undefined,
          });
          return false;
        },
        onError: () => {
          this.update(entry, {
            ...task,
            message: "Нет связи с сервером. Проверяем результат…",
          });
          return true;
        },
        delays: gitOperationPollingDelays,
      });
    }
    if (entry.listeners.size) entry.poller.start();
  }

  acknowledge(key: string, task: GitOperationTask) {
    const entry = this.entries.get(key);
    if (entry?.task === task) {
      entry.poller?.dispose();
      entry.poller = undefined;
      this.update(entry, null);
    }
  }

  clear() {
    for (const entry of this.entries.values()) entry.poller?.dispose();
    this.entries.clear();
  }
}

export const gitOperationStore = new GitOperationStore();
