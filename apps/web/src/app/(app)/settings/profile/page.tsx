import { beginTwoFactorAction } from "@/app/actions";
import { CriticalForm } from "@/components/critical-form";
import { SettingsNavigation } from "@/components/settings-navigation";
import { repository, requireUser } from "@/lib/server";

export default async function ProfilePage({
  searchParams,
  params,
}: {
  searchParams: Promise<{ error?: string }>;
  params?: Promise<{ projectId?: string }>;
}) {
  const current = await requireUser();
  const projectId = (await params)?.projectId;
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
      <h2>Двухфакторная аутентификация</h2>
      {user?.totp_secret ? (
        <p>
          2FA включена. Код запрашивается при каждом входе и изменении пароля, проектов и
          подключений.
        </p>
      ) : (
        <>
          <p>
            Для существующего владельца сохранён вход по паролю. Для критичных действий подключите
            аутентификатор.
          </p>
          {error ? (
            <p className="form-error" role="alert">
              Пароль неверен или превышено число попыток. После 10 попыток подождите 15 минут.
            </p>
          ) : null}
          <form action={beginTwoFactorAction} className="settings-form">
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
          <CriticalForm kind="changePassword" className="settings-form">
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
