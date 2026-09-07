import { hashInvitationToken } from "@pushdocs/db";
import type { Metadata } from "next";
import { acceptInvitationAction } from "@/app/actions";
import { AuthPanel } from "@/components/auth-panel";
import { optionalUser, repository } from "@/lib/server";

export const metadata: Metadata = { title: "Приглашение" };

export default async function InvitationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { token } = await params;
  const invitation = await repository().getInvitation(hashInvitationToken(token));
  const current = await optionalUser();
  const query = await searchParams;
  if (!invitation) {
    return (
      <AuthPanel
        description="Ссылка уже использована, истекла или была отозвана."
        eyebrow="Приглашение"
        title="Приглашение недействительно"
      >
        <a className="pd-button pd-button--secondary auth-submit" href="/login">
          Перейти ко входу
        </a>
      </AuthPanel>
    );
  }
  const roleLabel =
    invitation.role === "admin"
      ? "администратора"
      : invitation.role === "editor"
        ? "редактора"
        : "читателя";
  return (
    <AuthPanel
      description={`Вас пригласили в проект «${invitation.project_name}» с ролью ${roleLabel}.`}
      eyebrow="Приглашение в проект"
      title={current ? "Подтвердите участие" : "Создайте учётную запись"}
    >
      {query.error === "credentials" ? (
        <p className="form-error" role="alert">
          Пароль существующей учётной записи не подошёл.
        </p>
      ) : null}
      <form action={acceptInvitationAction} className="auth-form">
        <input name="token" type="hidden" value={token} />
        <label>
          Email
          <input readOnly value={invitation.email} />
        </label>
        {!current ? (
          <>
            <label>
              Имя
              <input name="displayName" required minLength={2} autoComplete="name" />
            </label>
            <label>
              Пароль
              <input
                name="password"
                required
                minLength={12}
                type="password"
                autoComplete="current-password"
              />
              <span className="field-note">
                Для новой учётной записи придумайте пароль; для существующей введите текущий.
              </span>
            </label>
          </>
        ) : (
          <>
            <input name="displayName" type="hidden" value={current.displayName} />
            <input name="password" type="hidden" value="not-used-for-current-user" />
          </>
        )}
        <button className="pd-button pd-button--primary auth-submit" type="submit">
          Принять приглашение
        </button>
      </form>
    </AuthPanel>
  );
}
