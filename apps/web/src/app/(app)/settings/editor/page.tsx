import { redirect } from "next/navigation";
import { EditorSettings } from "@/components/editor-settings";
import { SettingsNavigation } from "@/components/settings-navigation";
import { SettingsProjectPicker } from "@/components/settings-project-picker";
import { repository, requireUser } from "@/lib/server";
import { settingsPath } from "@/lib/settings-path";
import { settingsProjectChoices, settingsProjectId } from "@/lib/settings-project";

export default async function EditorSettingsPage({
  params,
}: {
  params?: Promise<{ projectId?: string }>;
} = {}) {
  const user = await requireUser();
  const projectId = (await params)?.projectId;
  if (!projectId) {
    const selected = await settingsProjectId(user);
    if (selected) redirect(settingsPath("editor", selected));
  }
  if (projectId) await repository().requireProjectAccess(user.id, projectId);
  return (
    <section className="page narrow-page">
      <header className="page-header">
        <h1>Редактор</h1>
      </header>
      <SettingsNavigation
        projectId={projectId}
        active="editor"
        canManageConnections={user.isInstanceOperator}
      />
      {!projectId ? <SettingsProjectPicker projects={await settingsProjectChoices(user)} /> : null}
      <EditorSettings />
    </section>
  );
}
