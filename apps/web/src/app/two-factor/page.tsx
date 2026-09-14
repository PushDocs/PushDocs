import { createTotpUri, decryptSecret } from "@pushdocs/db";
import { KeyRound, ScanLine, ShieldCheck } from "lucide-react";
import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { beginTwoFactorAction, logoutAction, verifyTwoFactorAction } from "@/app/actions";
import { AuthPanel } from "@/components/auth-panel";
import { CopyTwoFactorSecret } from "@/components/copy-two-factor-secret";
import { authenticationSession } from "@/lib/two-factor";

export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const session = await authenticationSession();
  if (session.purpose === "full") redirect("/settings/profile");
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
      wide={Boolean(secret)}
      title={setup ? "Настройте двухфакторный вход" : "Подтвердите вход"}
      description={
        setup
          ? "Добавьте PushDocs в приложение-аутентификатор и подтвердите первый код."
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
        <div className="two-factor-setup">
          <section className="two-factor-step" aria-labelledby="two-factor-scan-title">
            <header className="two-factor-step-header">
              <span className="two-factor-step-number">1</span>
              <div>
                <h2 id="two-factor-scan-title">Добавьте аккаунт</h2>
                <p>Отсканируйте QR-код в Google Authenticator или другом приложении.</p>
              </div>
            </header>
            <div className="two-factor-qr">
              <ScanLine aria-hidden size={20} />
              {/* biome-ignore lint/performance/noImgElement: private locally generated QR must never pass through an image optimizer */}
              <img
                src={await QRCode.toDataURL(createTotpUri(session.email, secret), { width: 224 })}
                width={224}
                height={224}
                alt="QR-код для подключения аутентификатора"
              />
            </div>
            <div className="two-factor-manual">
              <KeyRound aria-hidden size={17} />
              <CopyTwoFactorSecret value={secret} />
            </div>
            <p className="field-note two-factor-recovery-note">
              Сохраните ключ в менеджере паролей. Он поможет восстановить аутентификатор при потере
              телефона.
            </p>
          </section>

          <section
            className="two-factor-step two-factor-confirm-step"
            aria-labelledby="two-factor-confirm-title"
          >
            <header className="two-factor-step-header">
              <span className="two-factor-step-number">2</span>
              <div>
                <h2 id="two-factor-confirm-title">Подтвердите подключение</h2>
                <p>Введите текущий шестизначный код из приложения.</p>
              </div>
            </header>
            <form action={verifyTwoFactorAction} className="auth-form two-factor-code-form">
              <label>
                Код из приложения
                <input
                  className="two-factor-code"
                  name="otp"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  minLength={6}
                  maxLength={6}
                  placeholder="000000"
                  required
                />
              </label>
              <button className="pd-button pd-button--primary" type="submit">
                Включить 2FA
              </button>
            </form>
            <p className="two-factor-security-note">
              <ShieldCheck aria-hidden size={18} />
              Письма для восстановления не отправляются. Сохранённый ключ останется резервным
              способом переноса аутентификатора.
            </p>
          </section>
        </div>
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
      ) : secret ? null : (
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
      <form action={logoutAction} className={secret ? "two-factor-exit" : undefined}>
        <button type="submit" className="pd-button pd-button--secondary">
          Выйти
        </button>
      </form>
    </AuthPanel>
  );
}
