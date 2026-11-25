import { BranchCreationStatusFailure } from "@pushdocs/contracts";
import { branchCreationStatusAction } from "@/app/actions";
import { gitOperationPollingDelays } from "./git-operation-timing";
import { PollingLifecycle } from "./polling-lifecycle";

export enum BranchCreationOperationKind {
  Create = "create",
  Import = "import",
  SourceSync = "source-sync",
}

export interface BranchCreationScope {
  ownerId?: string;
  projectId: string;
  sourceBranch: string;
}

export interface BranchCreationOperation {
  jobId: string;
  name: string;
  sourceBranch: string;
  kind: BranchCreationOperationKind;
  ready?: boolean;
}

const branchCreationStorage = { prefix: "pushdocs:branch-creation:", version: 1 } as const;
const branchCreationPollingLimits = { consecutiveErrors: 3 } as const;
const statusMessages: Record<BranchCreationStatusFailure, string> = {
  [BranchCreationStatusFailure.AuthenticationRequired]:
    "Сессия истекла. Войдите заново, чтобы проверить состояние операции.",
  [BranchCreationStatusFailure.AccessDenied]:
    "Нет доступа к проекту. Проверка операции остановлена. Уточните доступ у администратора.",
  [BranchCreationStatusFailure.NotFound]:
    "Операция не найдена. Ветка могла быть создана. Проверьте список веток перед новым созданием.",
  [BranchCreationStatusFailure.Unavailable]:
    "Не удаётся проверить состояние операции. Она могла продолжиться на сервере. Повторите проверку.",
};

class BranchCreationSessionStore {
  private operations = new Map<string, BranchCreationOperation>();
  private enqueues = new Map<string, Promise<BranchCreationOperation>>();

  private key(scope: BranchCreationScope) {
    return scope.ownerId
      ? `${branchCreationStorage.prefix}${JSON.stringify([scope.ownerId, scope.projectId])}`
      : undefined;
  }

  read(scope: BranchCreationScope): BranchCreationOperation | undefined {
    const key = this.key(scope);
    if (!key) return;
    const cached = this.operations.get(key);
    if (cached) return cached;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (
        saved?.version === branchCreationStorage.version &&
        typeof saved.jobId === "string" &&
        saved.jobId &&
        typeof saved.name === "string" &&
        saved.name &&
        typeof saved.sourceBranch === "string" &&
        saved.sourceBranch &&
        Object.values(BranchCreationOperationKind).includes(saved.kind) &&
        (saved.ready === undefined || typeof saved.ready === "boolean")
      ) {
        const { jobId, name, sourceBranch, kind, ready } = saved;
        const operation = { jobId, name, sourceBranch, kind, ready };
        this.operations.set(key, operation);
        return operation;
      }
    } catch {
      // An unavailable or damaged browser cache must not prevent a live operation.
    }
  }

  remember(scope: BranchCreationScope, operation: BranchCreationOperation) {
    const key = this.key(scope);
    if (!key) return;
    this.operations.set(key, operation);
    try {
      sessionStorage.setItem(
        key,
        JSON.stringify({ version: branchCreationStorage.version, ...operation }),
      );
    } catch {
      // Keep same-page recovery available when browser storage is disabled.
    }
  }

  forget(scope: BranchCreationScope, jobId: string) {
    const key = this.key(scope);
    if (!key || this.read(scope)?.jobId !== jobId) return;
    this.operations.delete(key);
    try {
      sessionStorage.removeItem(key);
    } catch {
      // Optional browser storage.
    }
  }

  pending(scope: BranchCreationScope) {
    const key = this.key(scope);
    return key ? this.enqueues.get(key) : undefined;
  }

  enqueue(
    scope: BranchCreationScope,
    name: string,
    kind: BranchCreationOperationKind,
    request: () => Promise<{ jobId: string; name: string }>,
  ): Promise<BranchCreationOperation> {
    const key = this.key(scope);
    const pending = this.pending(scope);
    if (pending) return pending;
    const promise: Promise<BranchCreationOperation> = Promise.resolve()
      .then(async () => {
        const result = await request();
        const operation = {
          ...result,
          name: result.name || name,
          sourceBranch: scope.sourceBranch,
          kind,
        };
        if (!key || this.enqueues.get(key) === promise) this.remember(scope, operation);
        return operation;
      })
      .finally(() => {
        if (key && this.enqueues.get(key) === promise) this.enqueues.delete(key);
      });
    if (key) this.enqueues.set(key, promise);
    return promise;
  }

  clear() {
    this.operations.clear();
    this.enqueues.clear();
  }
}

export const branchCreationSessions = new BranchCreationSessionStore();

export class BranchCreationCancelled extends Error {}

export class BranchCreationReadError extends Error {
  constructor(code: BranchCreationStatusFailure) {
    super(statusMessages[code]);
  }
}

type BranchCreationJob = NonNullable<Awaited<ReturnType<typeof branchCreationStatusAction>>["job"]>;

export class BranchCreationJobFailed extends Error {
  operation?: BranchCreationOperation;

  constructor(readonly job: BranchCreationJob) {
    super(job.last_error || "Не удалось выполнить операцию. Повторите попытку.");
  }
}

export class BranchCreationObserver {
  private controller = new AbortController();
  private poller?: PollingLifecycle<Awaited<ReturnType<typeof branchCreationStatusAction>>>;
  private cancelWaiting?: () => void;

  get signal() {
    return this.controller.signal;
  }

  check() {
    if (this.signal.aborted) throw new BranchCreationCancelled();
  }

  dispose() {
    this.controller.abort();
    this.poller?.dispose();
    this.cancelWaiting?.();
    this.cancelWaiting = undefined;
  }

  wait(
    projectId: string,
    jobId: string,
    onJob: (job: BranchCreationJob) => void,
    onRetry: () => void,
  ): Promise<BranchCreationJob> {
    this.check();
    return new Promise((resolve, reject) => {
      let failures = 0;
      const finish = (job?: BranchCreationJob, error?: Error) => {
        this.poller?.dispose();
        this.cancelWaiting = undefined;
        if (error) reject(error);
        else if (job) resolve(job);
        return false;
      };
      this.cancelWaiting = () => finish(undefined, new BranchCreationCancelled());
      this.poller = new PollingLifecycle({
        request: () => branchCreationStatusAction(projectId, jobId),
        onResult: (result) => {
          failures = 0;
          if (result.error) return finish(undefined, new BranchCreationReadError(result.error));
          onJob(result.job);
          if (result.job.status === "failed")
            return finish(undefined, new BranchCreationJobFailed(result.job));
          if (result.job.status === "done") return finish(result.job);
          return true;
        },
        onError: () => {
          failures += 1;
          if (failures >= branchCreationPollingLimits.consecutiveErrors)
            return finish(
              undefined,
              new BranchCreationReadError(BranchCreationStatusFailure.Unavailable),
            );
          onRetry();
          return true;
        },
        delays: gitOperationPollingDelays,
      });
      this.poller.start();
    });
  }
}
