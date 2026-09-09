import { Cable, Code2, GitBranch, Plus } from "lucide-react";
import { createConnectionAction } from "@/app/actions";
import { repository, requireOperator } from "@/lib/server";
import { SettingsNavigation } from "./settings-navigation";

export async function ConnectionSettings({ projectId }: { projectId?: string }) {
  const user = await requireOperator();
  if (projectId) await repository().requireProjectAccess(user.id, projectId);
  const connections = await repository().listConnections();
  return (
    <div className="page narrow-page">
      <header className="page-header">
        <div>
          <h1>Git-подключения</h1>
        </div>
      </header>

      {projectId ? (
        <SettingsNavigation projectId={projectId} active="connections" canManageConnections />
      ) : null}
      <section className="settings-grid">
        <div className="settings-list">
          <h2>Подключено</h2>
          {connections.length === 0 ? (
            <div className="settings-empty">
              <Cable aria-hidden />
              <p>Добавьте GitHub или GitLab, прежде чем создавать проект.</p>
            </div>
          ) : (
            connections.map((connection) => (
              <div className="connection-row" key={connection.id}>
                <span className="provider-icon">
                  {connection.kind === "github" ? <Code2 aria-hidden /> : <GitBranch aria-hidden />}
                </span>
                <span>
                  <strong>{connection.name}</strong>
                  <small>{connection.base_url}</small>
                </span>
                <span className="connection-kind">{connection.kind}</span>
              </div>
            ))
          )}
        </div>

        <form action={createConnectionAction} className="settings-form">
          {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
          <div className="section-title">
            <span className="section-icon">
              <Plus aria-hidden size={18} />
            </span>
            <div>
              <h2>Новое подключение</h2>
            </div>
          </div>
          <label>
            Название
            <input name="name" placeholder="GitLab компании" required />
          </label>
          <label>
            Провайдер
            <select name="kind" defaultValue="gitlab">
              <option value="gitlab">GitLab</option>
              <option value="github">GitHub</option>
            </select>
          </label>
          <label>
            Адрес
            <input name="baseUrl" type="url" defaultValue="https://gitlab.com" required />
          </label>
          <label>
            Access token
            <input name="token" type="password" autoComplete="off" required />
          </label>
          <button className="pd-button pd-button--primary" type="submit">
            Сохранить подключение
          </button>
        </form>
      </section>
    </div>
  );
}
