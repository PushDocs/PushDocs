import { gitOperationStatusAction, startGitOperationAction } from "@/app/actions";
import { gitOperationPollingDelays } from "./git-operation-timing";

export enum GitOperationKind {
  Pull = "pull",
  Merge = "merge",
  Reviews = "reviews",
  CreateReview = "create-review",
  UpdateBranch = "update-branch",
}

export type GitOperationTask = {
  kind: GitOperationKind;
  phase: "preparing" | "running" | "done" | "failed";
  jobId?: string;
  message?: string;
};

type Entry = {
  task: GitOperationTask | null;
  listeners: Set<() => void>;
  polling: boolean;
  timer?: ReturnType<typeof setTimeout>;
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
      entry = { task: null, listeners: new Set(), polling: false };
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
    void this.poll(key, projectId, entry);
    return () => {
      entry.listeners.delete(listener);
      if (!entry.listeners.size) clearTimeout(entry.timer);
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
      void this.poll(key, input.projectId, entry);
    } catch {
      if (this.entries.get(key) !== entry) return;
      this.update(entry, {
        kind,
        phase: "failed",
        message: "Не удалось начать операцию. Повторите попытку.",
      });
    }
  }

  private async poll(key: string, projectId: string, entry: Entry) {
    const task = entry.task;
    if (!entry.listeners.size || entry.polling || task?.phase !== "running" || !task.jobId) return;
    clearTimeout(entry.timer);
    entry.polling = true;
    let delay: number = gitOperationPollingDelays.normal;
    try {
      const result = await gitOperationStatusAction(projectId, task.jobId);
      if (this.entries.get(key) !== entry || entry.task !== task) return;
      if (result.status === "done" || result.status === "failed") {
        this.update(entry, {
          ...task,
          phase: result.status,
          message:
            result.status === "failed"
              ? result.last_error || "Операция не завершена. Повторите попытку."
              : undefined,
        });
      }
    } catch {
      if (this.entries.get(key) !== entry || entry.task !== task) return;
      this.update(entry, {
        ...task,
        message: "Нет связи с сервером. Проверяем результат…",
      });
      delay = gitOperationPollingDelays.retry;
    } finally {
      entry.polling = false;
      if (
        this.entries.get(key) === entry &&
        entry.task?.phase === "running" &&
        entry.listeners.size
      )
        entry.timer = setTimeout(() => void this.poll(key, projectId, entry), delay);
    }
  }

  acknowledge(key: string, task: GitOperationTask) {
    const entry = this.entries.get(key);
    if (entry?.task === task) this.update(entry, null);
  }

  clear() {
    for (const entry of this.entries.values()) clearTimeout(entry.timer);
    this.entries.clear();
  }
}

export const gitOperationStore = new GitOperationStore();
