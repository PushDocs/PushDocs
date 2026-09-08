import { SitePreview } from "@/components/site-preview";
import { repository, requireUser } from "@/lib/server";
import { workbenchContext } from "@/lib/workbench";
export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const { projectId } = await params;
  const user = await requireUser();
  await repository().requireProjectAccess(user.id, projectId);
  const target = await repository().getProjectSyncTarget(projectId);
  if (!target) return <p>Проект недоступен</p>;
  const branch = (await searchParams).branch ?? target.default_branch;
  const { state, access } = await workbenchContext(projectId, branch);
  return (
    <SitePreview
      projectId={projectId}
      branch={branch}
      revision={state.changeSet?.revision ?? 0}
      canBuild={access.role !== "reader"}
    />
  );
}
