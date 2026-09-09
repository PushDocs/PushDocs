import { articleRoute } from "@/components/preview-page-url";
import { SitePreview } from "@/components/site-preview";
import { repository, requireUser } from "@/lib/server";
import { workbenchContext } from "@/lib/workbench";
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; path?: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  await repository().requireProjectAccess(user.id, projectId);
  const target = await repository().getProjectSyncTarget(projectId);
  if (!target) return <p>Проект недоступен</p>;
  const query = await searchParams;
  const branch = query.branch ?? target.default_branch;
  const { state, access, provider } = await workbenchContext(projectId, branch);
  const file = state.files.find((file) => file.path === query.path);
  let configuration = "";
  const configPath = state.branch.repository_paths.find((path) =>
    /^docusaurus\.config\.(ts|js|mjs|cjs)$/.test(path),
  );
  if (configPath) {
    const edited = state.files.find((file) => file.path === configPath);
    try {
      configuration =
        edited?.content ??
        new TextDecoder().decode(
          await provider.readBinary(
            target.provider_repository_id,
            state.branch.head_commit_sha,
            target.root_path === "." ? configPath : `${target.root_path}/${configPath}`,
          ),
        );
    } catch {
      configuration = "routeBasePath: unknown";
    }
  }
  const route = file ? articleRoute(file.path, file.content, configuration) : undefined;
  return (
    <SitePreview
      path={query.path}
      articleRoute={route}
      projectId={projectId}
      branch={branch}
      revision={state.changeSet?.revision ?? 0}
      canBuild={access.role !== "reader"}
    />
  );
}
