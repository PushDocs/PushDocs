"use client";
import { useEffect, useRef } from "react";
export function TwoFactorField() {
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <label>
      Код 2FA
      <input
        ref={input}
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
        <a href="/settings/profile">Настроить 2FA</a>
      </small>
    </label>
  );
}
