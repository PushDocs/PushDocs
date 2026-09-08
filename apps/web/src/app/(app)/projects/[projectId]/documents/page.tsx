import type { Metadata } from "next";
import { synchronizeBranchAction } from "@/app/actions";
import { Workbench } from "@/components/workbench";
import { actor, application, repository, requireUser } from "@/lib/server";
import { workbenchContext } from "@/lib/workbench";

export const metadata: Metadata = { title: "Документы" };

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; path?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const query = await searchParams;
  const branch = query.branch ?? project.defaultBranch;
  const branches = await repository().listBranches(projectId);
  if (!branches.some((item) => item.full_ref === branch))
    return (
      <section className="page">
        <h1>Импорт ветки</h1>
        <p>Структура проекта появится после завершения импорта.</p>
        <form action={synchronizeBranchAction}>
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="branch" value={branch} />
          <button className="pd-button pd-button--primary" type="submit">
            Повторить импорт
          </button>
        </form>
      </section>
    );
  const { state, config, access } = await workbenchContext(projectId, branch);
  return (
    <Workbench
      key={`${projectId}:${branch}`}
      projectId={projectId}
      projectName={project.name}
      components={await repository().listProjectComponents(projectId)}
      branch={branch}
      initialPath={query.path}
      initial={{
        files: state.files,
        config,
        revision: state.changeSet?.revision ?? 0,
        status: state.changeSet?.status ?? "open",
        sha: state.branch.head_commit_sha,
        repositoryPaths: state.branch.repository_paths,
        branches,
        role: access.role,
        changeSetId: state.changeSet?.id,
      }}
    />
  );
}
