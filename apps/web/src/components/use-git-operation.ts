"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { startGitOperationAction } from "@/app/actions";
import {
  type GitOperationKind,
  type GitOperationTask,
  gitOperationKey,
  gitOperationStore,
} from "./git-operation-store";

const serverSnapshot = () => null;

export function useGitOperation({
  projectId,
  branch,
  kind,
  successMessage,
  onComplete,
  onBusyChange,
}: {
  projectId: string;
  branch: string;
  kind: GitOperationKind;
  successMessage: (kind: GitOperationKind) => string;
  onComplete: () => unknown;
  onBusyChange?: (busy: boolean) => void;
}) {
  const key = gitOperationKey(projectId, branch, kind);
  const subscription = useMemo(
    () => ({
      subscribe: (listener: () => void) => gitOperationStore.subscribe(key, projectId, listener),
      snapshot: () => gitOperationStore.getSnapshot(key),
    }),
    [key, projectId],
  );
  const task = useSyncExternalStore(subscription.subscribe, subscription.snapshot, serverSnapshot);
  const [result, setResult] = useState<{ key: string; message: string; error: boolean }>();
  const callbacks = useRef({ successMessage, onComplete, onBusyChange });
  callbacks.current = { successMessage, onComplete, onBusyChange };
  const handled = useRef<{
    task: GitOperationTask;
    result: Promise<{ message: string; error: boolean }>;
  } | null>(null);
  const busy = !!task && task.phase !== "failed";
  const gitBusy = busy && task.phase !== "preparing";

  useEffect(() => {
    callbacks.current.onBusyChange?.(gitBusy);
    return () => callbacks.current.onBusyChange?.(false);
  }, [gitBusy]);

  useEffect(() => {
    if (!task || (task.phase !== "done" && task.phase !== "failed")) return;
    let active = true;
    if (handled.current?.task !== task) {
      handled.current = {
        task,
        result: (async () => {
          let error = task.phase === "failed";
          let message = task.message || callbacks.current.successMessage(task.kind);
          if (!error) {
            try {
              await callbacks.current.onComplete();
            } catch {
              error = true;
              message =
                "Операция в Git завершена, но данные не удалось перечитать. Обновите страницу.";
            }
          }
          return { message, error };
        })(),
      };
    }
    void handled.current.result.then((result) => {
      if (active) {
        setResult({ key, ...result });
        gitOperationStore.acknowledge(key, task);
      }
    });
    return () => {
      active = false;
    };
  }, [task, key]);

  return {
    busy,
    task,
    message: busy ? task.message || "" : result?.key === key ? result.message : "",
    error: !busy && result?.key === key && result.error,
    dismiss: () => setResult(undefined),
    start: (
      input: Parameters<typeof startGitOperationAction>[0],
      operationKind = kind,
      beforeStart?: () => Promise<boolean>,
    ) => {
      setResult(undefined);
      return gitOperationStore.start(key, operationKind, input, beforeStart);
    },
  };
}
