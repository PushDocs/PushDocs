import { createTotpUri, decryptSecret } from "@pushdocs/db";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { beginTwoFactorAction, logoutAction, verifyTwoFactorAction } from "@/app/actions";
import { AuthPanel } from "@/components/auth-panel";
import { authenticationSession } from "@/lib/two-factor";

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await authenticationSession();
  if (session.purpose === "full") redirect("/settings/security");
  const { error } = await searchParams;
  const setup = session.purpose === "setup";
  const secret =
    setup &&
    session.totp_pending_secret &&
    session.totp_pending_expires_at &&
    session.totp_pending_expires_at > new Date()
      ? decryptSecret(session.totp_pending_secret, `${session.id}:totp:pending`)
      : null;
  return (
    <AuthPanel
      title={setup ? "Настройте двухфакторный вход" : "Подтвердите вход"}
      description={
        setup
          ? "Добавьте PushDocs в Google Authenticator или другое приложение-аутентификатор. Доступ откроется после проверки первого кода."
          : "Введите свежий шестизначный код из приложения-аутентификатора."
      }
    >
      {error ? (
        <p className="form-error" role="alert">
          {error === "password"
            ? "Пароль неверен или превышено число попыток."
            : "Код неверен, уже использован или время настройки истекло."}{" "}
          После 10 попыток подождите 15 минут.
        </p>
      ) : null}
      {secret ? (
        <>
          {/* biome-ignore lint/performance/noImgElement: private locally generated QR must never pass through an image optimizer */}
          <img
            src={await QRCode.toDataURL(createTotpUri(session.email, secret), { width: 240 })}
            width={240}
            height={240}
            alt="QR-код для подключения аутентификатора"
          />
          <label>
            Ключ для ручного ввода
            <input readOnly value={secret} autoComplete="off" />
          </label>
          <p className="field-note">
            Сохраните ключ в менеджере паролей: он позволит восстановить аутентификатор при потере
            телефона. Письма для восстановления не отправляются.
          </p>
        </>
      ) : null}
      {setup && !secret ? (
        <form action={beginTwoFactorAction} className="auth-form">
          <p>Настройка истекла. Подтвердите пароль, чтобы начать снова.</p>
          <label>
            Пароль
            <input name="password" type="password" required autoComplete="current-password" />
          </label>
          <button type="submit" className="pd-button pd-button--primary">
            Начать заново
          </button>
        </form>
      ) : (
        <form action={verifyTwoFactorAction} className="auth-form">
          <label>
            Код 2FA
            <input
              name="otp"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              minLength={6}
              maxLength={6}
              required
            />
          </label>
          <button className="pd-button pd-button--primary" type="submit">
            {setup ? "Включить 2FA" : "Подтвердить вход"}
          </button>
        </form>
      )}
      <form action={logoutAction}>
        <button type="submit" className="pd-button pd-button--secondary">
          Выйти
        </button>
      </form>
    </AuthPanel>
  );
}
