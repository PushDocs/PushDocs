import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ConnectionSettings } from "@/components/connection-settings";
import { requireOperator } from "@/lib/server";
import { settingsProjectId } from "@/lib/settings-project";
export const metadata: Metadata = { title: "Подключения" };
export default async function ConnectionsPage() {
  const projectId = await settingsProjectId(await requireOperator());
  if (projectId) redirect(`/projects/${projectId}/settings/connections`);
  return <ConnectionSettings />;
}
