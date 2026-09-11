import type { Metadata } from "next";
import { BranchImport } from "@/components/branch-import";
import { Workbench } from "@/components/workbench";
import { actor, application, repository, requireUser } from "@/lib/server";
import { localWorkbenchContext } from "@/lib/workbench";

export const metadata: Metadata = { title: "Документы" };

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; path?: string; panel?: string }>;
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
    return <BranchImport key={branch} projectId={projectId} branch={branch} />;
  const { state, config, access } = await localWorkbenchContext(projectId, branch);
  if (
    state.branch.repository_paths.length === 0 &&
    state.files.length === 0 &&
    !(await repository().hasImportedBranch(state.branch.id))
  )
    return <BranchImport key={branch} projectId={projectId} branch={branch} />;
  return (
    <Workbench
      key={`${projectId}:${branch}`}
      projectId={projectId}
      projectName={project.name}
      components={await repository().listProjectComponents(projectId)}
      branch={branch}
      initialPath={query.path}
      initialPanel={query.panel === "files" ? "media" : undefined}
      initial={{
        ownerId: user.id,
        files: state.files,
        uploads: state.changeSet
          ? (await repository().listAttachments(projectId))
              .filter((file) => file.change_set_id === state.changeSet?.id)
              .map((file) => ({ path: file.repository_path }))
          : [],
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
