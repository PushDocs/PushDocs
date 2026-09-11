export function TwoFactorField() {
  return (
    <label>
      Код 2FA
      <input
        name="otp"
        aria-label="Код 2FA"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9]{6}"
        minLength={6}
        maxLength={6}
        required
        placeholder="000000"
      />
      <small>
        Свежий код из аутентификатора. Один код можно использовать только один раз.{" "}
        <a href="/settings/security">Настроить 2FA</a>
      </small>
    </label>
  );
}
