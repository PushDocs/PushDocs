"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  BranchImportState,
  type BranchImportTask,
  branchImportStore,
  useBranchImport,
  useBranchImports,
} from "./branch-import-store";
import { GitTransferStatus } from "./git-transfer-status";
import { ProjectContext } from "./project-context";

function ImportProgress({ task }: { task?: BranchImportTask }) {
  if (task?.state === BranchImportState.Failed)
    return (
      <>
        <p role="alert">{task.error}</p>
        <button
          className="pd-button pd-button--primary"
          type="button"
          onClick={() => branchImportStore.ensure(task, true)}
        >
          Повторить загрузку
        </button>
      </>
    );
  return (
    <>
      <GitTransferStatus
        label={
          !task || task.state === BranchImportState.Starting
            ? "Подготавливаем загрузку…"
            : task.state === BranchImportState.Queued
              ? "Ожидаем загрузку…"
              : task.state === BranchImportState.Done
                ? "Открываем документы…"
                : "Получаем файлы…"
        }
        transfer={task?.transfer}
        ariaLabel="Загрузка файлов ветки"
      />
      {task?.notice ? <p className="muted">{task.notice}</p> : null}
    </>
  );
}

export function ProjectBranchImportProgress({
  projectId,
  ownerId,
  hidden = false,
}: {
  projectId?: string;
  ownerId: string;
  hidden?: boolean;
}) {
  const tasks = useBranchImports();
  useEffect(() => branchImportStore.connect(ownerId), [ownerId]);
  const pending = tasks.filter(
    (task) => task.projectId === projectId && task.state !== BranchImportState.Done,
  );
  if (hidden || !pending.length) return null;
  return (
    <aside className="project-import-progress" aria-label="Фоновые загрузки веток">
      {pending.map((task) => (
        <section key={task.branch}>
          <header>
            <strong>Загрузка ветки · {task.branch}</strong>
            <Link
              href={`/projects/${task.projectId}/documents?${new URLSearchParams({ branch: task.branch })}`}
            >
              Открыть документы
            </Link>
          </header>
          <ImportProgress task={task} />
        </section>
      ))}
    </aside>
  );
}

export function BranchImport({ projectId, branch }: { projectId: string; branch: string }) {
  const router = useRouter();
  const task = useBranchImport(projectId, branch);
  const refreshed = useRef<BranchImportTask | undefined>(undefined);
  useEffect(() => {
    if (task?.state === BranchImportState.Done && refreshed.current !== task) {
      refreshed.current = task;
      router.refresh();
    }
  }, [task, router]);
  return (
    <section className="page branch-import">
      <ProjectContext projectId={projectId} branch={branch} />
      <header className="page-header">
        <h1>{branch}</h1>
      </header>
      <div className="branch-import-state">
        {task?.state !== BranchImportState.Failed ? (
          <p className="muted">Можно перейти в другой раздел. Загрузка продолжится на сервере.</p>
        ) : null}
        <ImportProgress task={task} />
      </div>
    </section>
  );
}
