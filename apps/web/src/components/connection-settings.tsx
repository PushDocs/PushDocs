import { Select } from "@pushdocs/ui";
import { Cable } from "lucide-react";
import { deleteConnectionAction, saveConnectionSettingsAction } from "@/app/actions";
import { repository, requireOperator } from "@/lib/server";
import { ConnectionCard } from "./connection-card";
import { CreateConnectionDialog } from "./create-connection-dialog";
import { CriticalForm } from "./critical-form";
import { SettingsNavigation } from "./settings-navigation";

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
      ) : (
        <SettingsNavigation active="connections" canManageConnections />
      )}
      <section className="connections-layout">
        <div className="settings-list">
          <h2>Подключено</h2>
          {connectionRows.length === 0 ? (
            <div className="settings-empty">
              <Cable aria-hidden />
              <p>Добавьте GitHub или GitLab, прежде чем создавать проект.</p>
            </div>
          ) : (
            connectionRows.map((connection) => (
              <ConnectionCard
                key={connection.id}
                connection={{
                  id: connection.id,
                  name: connection.name,
                  baseUrl: connection.base_url,
                  kind: connection.kind,
                  projectCount: connection.projectCount,
                  vpnSlot: connection.vpn_slot,
                }}
                projectId={projectId}
                updateAction={saveConnectionSettingsAction}
                deleteAction={deleteConnectionAction}
              />
            ))
          )}
        </div>

        <CreateConnectionDialog>
          <CriticalForm kind="createConnection" className="connection-edit-form">
            {projectId ? <input type="hidden" name="projectId" value={projectId} /> : null}
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
            <label>
              Профиль OpenVPN
              <input
                name="vpnProfile"
                type="file"
                accept=".ovpn,application/x-openvpn-profile,text/plain"
              />
              <small>Необязательно.</small>
            </label>
            <button className="pd-button pd-button--primary" type="submit">
              Сохранить подключение
            </button>
          </CriticalForm>
        </CreateConnectionDialog>
      </section>
    </div>
  );
}
