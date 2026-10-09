import { PreviewViewer } from "@/components/preview-viewer";
import { repository, requireUser } from "@/lib/server";

export default async function PreviewView({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string }>;
}) {
  const [user, { projectId }, { branch = "" }] = await Promise.all([
    requireUser(),
    params,
    searchParams,
  ]);
  const store = repository();
  await store.requireProjectAccess(user.id, projectId);
  await store.getBranchState(projectId, branch);
  return (
    <div className="page previews-page">
      <header className="page-header">
        <h1>Предпросмотр: {branch}</h1>
      </header>
      <PreviewViewer projectId={projectId} branch={branch} />
    </div>
  );
}
