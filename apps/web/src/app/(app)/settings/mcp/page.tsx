import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { SettingsNavigation } from "@/components/settings-navigation";
import { SettingsProjectPicker } from "@/components/settings-project-picker";
import { mcpStore, resourceUri } from "@/lib/mcp/oauth";
import { repository, requireUser } from "@/lib/server";
import { settingsPath } from "@/lib/settings-path";
import { settingsProjectChoices, settingsProjectId } from "@/lib/settings-project";

async function revokeGrant(form: FormData) {
  "use server";
  const user = await requireUser();
  await mcpStore().revokeGrant(z.string().uuid().parse(form.get("grantId")), user.id);
  revalidatePath(settingsPath("mcp"));
  revalidatePath(settingsPath("mcp", "[projectId]"), "page");
}
export default async function McpSettingsPage({
  params,
}: {
  params?: Promise<{ projectId?: string }>;
} = {}) {
  const user = await requireUser();
  const projectId = (await params)?.projectId;
  if (!projectId) {
    const selected = await settingsProjectId(user);
    if (selected) redirect(settingsPath("mcp", selected));
  }
  if (projectId) await repository().requireProjectAccess(user.id, projectId);
  const endpoint = resourceUri(),
    grants = await mcpStore().grants(user.id);
  return (
    <section className="page narrow-page">
      <header className="page-header">
        <h1>MCP</h1>
      </header>
      <SettingsNavigation
        projectId={projectId}
        active="mcp"
        canManageConnections={user.isInstanceOperator}
      />
      {!projectId ? <SettingsProjectPicker projects={await settingsProjectChoices(user)} /> : null}
      <p>
        Сервер доступен по адресу <code>{endpoint}</code>. Поддерживается MCP 2025-11-25 через
        Streamable HTTP.
      </p>
      <h2>Codex</h2>
      <pre>
        <code>{`codex mcp add pushdocs --url ${endpoint}`}</code>
      </pre>
      <h2>Claude Code</h2>
      <pre>
        <code>{`claude mcp add --transport http pushdocs ${endpoint}\nclaude mcp login pushdocs`}</code>
      </pre>
      <p>
        Авторизуйтесь в браузере и выберите проекты. Черновики ветки общие для пользователей
        проекта.
      </p>
      <h2>Разрешённые подключения</h2>
      {grants.length ? (
        grants.map((grant) => (
          <article key={grant.id}>
            <h3>{grant.name}</h3>
            <p>{grant.scopes.join(", ")}</p>
            <p>
              Проектов: {grant.projects.length}. Создано:{" "}
              {grant.created_at.toISOString().slice(0, 10)}
            </p>
            <form action={revokeGrant}>
              <input type="hidden" name="grantId" value={grant.id} />
              <button type="submit">Отозвать доступ</button>
            </form>
          </article>
        ))
      ) : (
        <p>Подключений нет.</p>
      )}
    </section>
  );
}
