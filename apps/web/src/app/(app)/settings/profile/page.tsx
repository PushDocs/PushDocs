import { redirect } from "next/navigation";
import { beginTwoFactorAction } from "@/app/actions";
import { CriticalForm } from "@/components/critical-form";
import { SettingsNavigation } from "@/components/settings-navigation";
import { SettingsProjectPicker } from "@/components/settings-project-picker";
import { repository, requireUser } from "@/lib/server";
import { settingsProjectChoices, settingsProjectId } from "@/lib/settings-project";

export default async function ProfilePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ error?: string }>;
  params?: Promise<{ projectId?: string }>;
}) {
  const current = await requireUser();
  const projectId = (await params)?.projectId;
  if (!projectId) {
    const selected = await settingsProjectId(current);
    if (selected) {
      const query = await searchParams;
      redirect(
        `/projects/${selected}/settings/profile${query.error ? `?error=${encodeURIComponent(query.error)}` : ""}`,
      );
    }
  }
  if (projectId) await repository().requireProjectAccess(current.id, projectId);
  const user = await repository().getSecurityUser(current.id);
  const { error } = await searchParams;
  return (
    <section className="page narrow-page">
      <header className="page-header">
        <h1>Профиль</h1>
      </header>
      <SettingsNavigation
        projectId={projectId}
        active="profile"
        canManageConnections={current.isInstanceOperator}
      />
      {!projectId ? (
        <SettingsProjectPicker projects={await settingsProjectChoices(current)} />
      ) : null}
      <h2>Двухфакторная аутентификация</h2>
      {user?.totp_secret ? (
        <p>
          2FA включена. Код запрашивается при каждом входе и изменении пароля, проектов и
          подключений.
        </p>
      ) : (
        <>
          <p>Подключите приложение-аутентификатор для подтверждения входа и изменения настроек.</p>
          {error ? (
            <p className="form-error" role="alert">
              Пароль неверен или превышено число попыток. После 10 попыток подождите 15 минут.
            </p>
          ) : null}
          <form action={beginTwoFactorAction} className="settings-form profile-form">
            <label>
              Текущий пароль
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <button type="submit" className="pd-button pd-button--primary">
              Подключить 2FA
            </button>
          </form>
        </>
      )}
      {user?.totp_secret ? (
        <>
          <h2>Сменить пароль</h2>
          <CriticalForm kind="changePassword" className="settings-form profile-form">
            <label>
              Текущий пароль
              <input name="password" type="password" required autoComplete="current-password" />
            </label>
            <label>
              Новый пароль
              <input
                name="newPassword"
                type="password"
                required
                minLength={12}
                maxLength={200}
                autoComplete="new-password"
              />
            </label>
            <p>После смены пароля все сеансы завершатся.</p>
            <button type="submit" className="pd-button pd-button--primary">
              Сменить пароль
            </button>
          </CriticalForm>
        </>
      ) : null}
    </section>
  );
}
