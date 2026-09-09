import type { Metadata } from "next";
import { ConnectionSettings } from "@/components/connection-settings";
export const metadata: Metadata = { title: "Подключения" };
export default async function ProjectConnectionsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  return <ConnectionSettings projectId={projectId} />;
}
