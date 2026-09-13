import { Select } from "@pushdocs/ui";
import { MailPlus, Shield, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import { inviteMemberAction } from "@/app/actions";
import { CriticalForm } from "@/components/critical-form";
import { CopyInvitation, MemberActions } from "@/components/member-actions";
import { SettingsNavigation } from "@/components/settings-navigation";
import { repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Участники" };

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ invitation?: string }>;
}) {
  const [user, { projectId }, query] = await Promise.all([requireUser(), params, searchParams]);
  const store = repository();
  const project = await store.getProjectForUser(user.id, projectId);
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const access = { role: project.role };
  const [members, invitations] = await Promise.all([
    store.listMembers(projectId),
    access.role === "admin" ? store.listInvitations(projectId) : Promise.resolve([]),
  ]);
  const invitationToken = query.invitation;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <h1>Участники</h1>
        </div>
      </header>
      <SettingsNavigation
        projectId={projectId}
        active="members"
        canManageConnections={user.isInstanceOperator}
      />
      {access.role === "admin" ? (
        <>
          {invitationToken ? (
            <div className="invitation-result">
              <strong>Приглашение создано</strong>
              <p>
                Отправьте ссылку пользователю в мессенджере. Она предназначена для одного
                пользователя, действует 24 часа и после принятия больше не работает. Письмо не
                отправляется.
              </p>
              <CopyInvitation
                value={`${process.env.PUSHDOCS_PUBLIC_ORIGIN ?? "http://localhost:3000"}/invite/${invitationToken}`}
              />
            </div>
          ) : null}
          <form action={inviteMemberAction} className="invite-form">
            <MailPlus aria-hidden />
            <label>
              <span className="sr-only">Email пользователя</span>
              <input name="email" type="email" placeholder="editor@example.com" required />
            </label>
            <div className="form-field">
              <label className="sr-only" htmlFor="invite-role">
                Роль
              </label>
              <Select
                defaultValue="editor"
                id="invite-role"
                label="Роль"
                name="role"
                options={[
                  { label: "Администратор", value: "admin" },
                  { label: "Редактор", value: "editor" },
                  { label: "Читатель", value: "reader" },
                ]}
              />
            </div>
            <input name="projectId" type="hidden" value={projectId} />
            <button className="pd-button pd-button--primary" type="submit">
              Создать приглашение
            </button>
          </form>
        </>
      ) : null}
      {invitations.length ? (
        <section className="pending-invitations">
          <h2>Ожидают приглашения</h2>
          {invitations.map((invitation) => (
            <div key={invitation.id}>
              <span className="pending-invitation-info">
                <strong>{invitation.email}</strong>
                <small>
                  {invitation.role === "admin"
                    ? "Администратор"
                    : invitation.role === "editor"
                      ? "Редактор"
                      : "Читатель"}{" "}
                  · до {new Date(invitation.expires_at).toLocaleString("ru-RU")}
                </small>
              </span>
              <CriticalForm
                kind="revokeInvitation"
                description={`Отменить приглашение: ${invitation.email}`}
              >
                <input type="hidden" name="projectId" value={projectId} />
                <input type="hidden" name="invitationId" value={invitation.id} />
                <button className="pd-button pd-button--secondary" type="submit">
                  Отменить приглашение
                </button>
              </CriticalForm>
            </div>
          ))}
        </section>
      ) : null}
      <div className="members-layout">
        <section className="members-table">
          <div className="members-head">
            <span>Пользователь</span>
            <span>Роль</span>
            <span>Статус</span>
            <span className="sr-only">Действия</span>
          </div>
          {members.map((member) => (
            <div className="member-row" key={member.id}>
              <span className="member-name">
                <span className="avatar">{member.display_name.slice(0, 1).toUpperCase()}</span>
                <span>
                  <strong>{member.display_name}</strong>
                  <small>{member.email}</small>
                </span>
              </span>
              <span className="role-label">
                <Shield aria-hidden size={15} />
                {member.role === "admin"
                  ? "Администратор"
                  : member.role === "editor"
                    ? "Редактор"
                    : "Читатель"}
              </span>
              <span className={member.status === "active" ? "active-state" : "blocked-state"}>
                {member.status === "active" ? "Активен" : "Заблокирован"}
              </span>
              {access.role === "admin" ? (
                <MemberActions
                  key={member.role}
                  projectId={projectId}
                  userId={member.id}
                  name={member.display_name}
                  role={member.role}
                />
              ) : null}
            </div>
          ))}
        </section>
        <section className="roles-panel" aria-labelledby="roles-heading">
          <h2 id="roles-heading">Права ролей</h2>
          <div>
            <Shield aria-hidden />
            <p>
              <strong>Администратор</strong>
              <span>Управляет пользователями и настройками проекта.</span>
            </p>
          </div>
          <div>
            <UserRound aria-hidden />
            <p>
              <strong>Редактор</strong>
              <span>Редактирует документы и отправляет изменения.</span>
            </p>
          </div>
          <div>
            <Users aria-hidden />
            <p>
              <strong>Читатель</strong>
              <span>Читает документы и оставляет комментарии.</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
