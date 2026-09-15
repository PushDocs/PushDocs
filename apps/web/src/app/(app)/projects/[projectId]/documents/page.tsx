import type { Metadata } from "next";
import { BranchImport } from "@/components/branch-import";
import { Workbench } from "@/components/workbench";
import { repository, requireUser } from "@/lib/server";
import { localWorkbenchIndexContext } from "@/lib/workbench";

export const metadata: Metadata = { title: "Документы" };

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; path?: string; panel?: string }>;
}) {
  const [user, { projectId }, query] = await Promise.all([requireUser(), params, searchParams]);
  const store = repository();
  const project = await store.getProjectForUser(user.id, projectId);
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const branch = query.branch ?? project.defaultBranch;
  const [branches, workbench] = await Promise.all([
    store.listBranches(projectId),
    localWorkbenchIndexContext(projectId, branch, user).then(
      (value) => ({ value, error: undefined }),
      (error: unknown) => ({ value: undefined, error }),
    ),
  ]);
  if (!branches.some((item) => item.full_ref === branch))
    return <BranchImport key={branch} projectId={projectId} branch={branch} />;
  if (!workbench.value) throw workbench.error;
  const { state, config, access } = workbench.value;
  const needsImport = state.branch.repository_paths.length === 0 && state.files.length === 0;
  const [components, uploads, imported] = await Promise.all([
    store.listProjectComponents(projectId),
    state.changeSet
      ? store
          .listAttachmentsForChangeSet(projectId, state.changeSet.id)
          .then((files) => files.map((file) => ({ path: file.repository_path })))
      : Promise.resolve([]),
    needsImport ? store.hasImportedBranch(state.branch.id) : Promise.resolve(true),
  ]);
  if (needsImport && !imported)
    return <BranchImport key={branch} projectId={projectId} branch={branch} />;
  const initialFilePath =
    (query.path && state.files.some((file) => file.path === query.path) ? query.path : undefined) ??
    state.files.find(
      (file) =>
        file.status !== "delete" && /\.mdx?$/.test(file.path) && !file.path.startsWith("i18n/"),
    )?.path ??
    state.files.find((file) => file.status !== "delete")?.path;
  const selectedFile = initialFilePath
    ? await store.getWorkingFile(projectId, branch, initialFilePath)
    : undefined;
  return (
    <Workbench
      key={`${projectId}:${branch}`}
      projectId={projectId}
      projectName={project.name}
      defaultBranch={project.defaultBranch}
      components={components}
      branch={branch}
      initialPath={query.path ?? initialFilePath}
      initialPanel={query.panel === "files" ? "media" : undefined}
      initial={{
        collaboration: true,
        ownerId: user.id,
        files: state.files.map((file) =>
          file.path === initialFilePath && selectedFile ? selectedFile : file,
        ),
        uploads,
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
