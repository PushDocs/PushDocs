import type { Metadata } from "next";
import { PreviewList } from "@/components/preview-list";
import { repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Предпросмотр" };

export default async function PreviewsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const [user, { projectId }] = await Promise.all([requireUser(), params]);
  const access = await repository().requireProjectAccess(user.id, projectId);
  return (
    <div className="page previews-page">
      <header className="page-header">
        <h1>Предпросмотр</h1>
      </header>
      <PreviewList projectId={projectId} canDelete={access.role === "admin"} />
    </div>
  );
}
