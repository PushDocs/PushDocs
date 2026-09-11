import { Select } from "@pushdocs/ui";
import { Cable, Code2, GitBranch, Pencil, Plus, Trash2 } from "lucide-react";
import {
  createConnectionAction,
  deleteConnectionAction,
  updateConnectionAction,
} from "@/app/actions";
import { repository, requireOperator } from "@/lib/server";
import { SettingsNavigation } from "./settings-navigation";

function projectsLabel(count: number): string {
  const form = new Intl.PluralRules("ru").select(count);
  const noun = form === "one" ? "проект" : form === "few" ? "проекта" : "проектов";
  return `${count} ${noun}`;
}

export async function ConnectionSettings({ projectId }: { projectId?: string }) {
  const user = await requireOperator();
  if (projectId) await repository().requireProjectAccess(user.id, projectId);
  const connections = await repository().listConnections();
  const connectionRows = await Promise.all(
    connections.map(async (connection) => ({
      ...connection,
      projectCount: await repository().countConnectionProjects(connection.id),
    })),
  );
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
          {connectionRows.length === 0 ? (
            <div className="settings-empty">
              <Cable aria-hidden />
              <p>Добавьте GitHub или GitLab, прежде чем создавать проект.</p>
            </div>
          ) : (
            connectionRows.map((connection) => (
              <article className="connection-card" key={connection.id}>
                <div className="connection-row">
                  <span className="provider-icon">
                    {connection.kind === "github" ? (
                      <Code2 aria-hidden />
                    ) : (
                      <GitBranch aria-hidden />
                    )}
                  </span>
                  <span>
                    <strong>{connection.name}</strong>
                    <small>{connection.base_url}</small>
                    <small>{projectsLabel(connection.projectCount)}</small>
                  </span>
                  <span className="connection-kind">{connection.kind}</span>
                </div>
                <details className="connection-editor">
                  <summary>
                    <Pencil aria-hidden size={15} />
                    Редактировать
                  </summary>
                  <form action={updateConnectionAction} className="connection-edit-form">
                    <input name="connectionId" type="hidden" value={connection.id} />
                    {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
                    <label>
                      Название
                      <input name="name" defaultValue={connection.name} required />
                    </label>
                    <label>
                      Адрес
                      <input
                        name="baseUrl"
                        type="url"
                        defaultValue={connection.base_url}
                        readOnly={connection.projectCount > 0}
                        required
                      />
                      {connection.projectCount > 0 ? (
                        <small>Адрес нельзя менять, пока подключение используется проектами.</small>
                      ) : null}
                    </label>
                    <label>
                      Новый access token
                      <input
                        name="token"
                        type="password"
                        autoComplete="off"
                        placeholder="Оставьте пустым, чтобы сохранить текущий"
                      />
                    </label>
                    <div className="connection-actions">
                      <button className="pd-button pd-button--primary" type="submit">
                        Сохранить
                      </button>
                    </div>
                  </form>
                  <div className="connection-danger">
                    <h3>Удалить подключение</h3>
                    {connection.projectCount > 0 ? (
                      <p>Сначала удалите все проекты, которые используют это подключение.</p>
                    ) : (
                      <form action={deleteConnectionAction}>
                        <input name="connectionId" type="hidden" value={connection.id} />
                        <label>
                          Введите <strong>{connection.name}</strong> для подтверждения
                          <input name="confirmation" required autoComplete="off" />
                        </label>
                        <button className="pd-button pd-button--danger" type="submit">
                          <Trash2 aria-hidden size={15} />
                          Удалить подключение
                        </button>
                      </form>
                    )}
                  </div>
                </details>
              </article>
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
          <div className="form-field">
            <label htmlFor="new-connection-kind">Провайдер</label>
            <Select
              defaultValue="gitlab"
              id="new-connection-kind"
              label="Провайдер"
              name="kind"
              options={[
                { label: "GitLab", value: "gitlab" },
                { label: "GitHub", value: "github" },
              ]}
            />
          </div>
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
