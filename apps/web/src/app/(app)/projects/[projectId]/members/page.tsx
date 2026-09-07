import { MailPlus, Shield, UserRound, Users } from "lucide-react";
import type { Metadata } from "next";
import { inviteMemberAction } from "@/app/actions";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Участники" };

export default async function MembersPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ invitation?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const access = await repository().requireProjectAccess(user.id, projectId);
  const members = await repository().listMembers(projectId);
  const invitationToken = (await searchParams).invitation;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Участники</h1>
          <p>Роль действует только в этом проекте.</p>
        </div>
      </header>
      <div className="members-layout">
        <section className="members-table">
          <div className="members-head">
            <span>Участник</span>
            <span>Роль</span>
            <span>Статус</span>
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
            </div>
          ))}
        </section>
        <aside className="roles-panel">
          <h2>Три роли</h2>
          <div>
            <Shield aria-hidden />
            <p>
              <strong>Администратор</strong>
              <span>Управляет участниками и настройками проекта.</span>
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
        </aside>
      </div>
      {access.role === "admin" ? (
        <>
          {invitationToken ? (
            <div className="invitation-result" role="status">
              <strong>Приглашение создано</strong>
              <p>Передайте участнику одноразовую ссылку. Она действует семь дней.</p>
              <input
                readOnly
                value={`/invite/${invitationToken}`}
                aria-label="Ссылка приглашения"
              />
            </div>
          ) : null}
          <form action={inviteMemberAction} className="invite-form">
            <MailPlus aria-hidden />
            <label>
              <span className="sr-only">Email участника</span>
              <input name="email" type="email" placeholder="editor@example.com" required />
            </label>
            <label>
              <span className="sr-only">Роль</span>
              <select name="role" defaultValue="editor">
                <option value="admin">Администратор</option>
                <option value="editor">Редактор</option>
                <option value="reader">Читатель</option>
              </select>
            </label>
            <input name="projectId" type="hidden" value={projectId} />
            <button className="pd-button pd-button--primary" type="submit">
              Создать приглашение
            </button>
          </form>
        </>
      ) : null}
    </div>
  );
}
