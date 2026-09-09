import { redirect } from "next/navigation";

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; document?: string }>;
}) {
  const { projectId } = await params;
  const { branch, document } = await searchParams;
  const query = new URLSearchParams({ panel: "files" });
  if (branch) query.set("branch", branch);
  if (document) query.set("path", document);
  redirect(`/projects/${projectId}/documents?${query}`);
}
