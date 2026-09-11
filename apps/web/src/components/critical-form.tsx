"use client";

import { type ReactNode, useState } from "react";
import { criticalSettingsAction } from "@/app/actions";
import { TwoFactorField } from "./two-factor-field";

export function CriticalForm({
  kind,
  className,
  children,
}: {
  kind: string;
  className?: string;
  children: ReactNode;
}) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        setPending(true);
        setError("");
        try {
          const result = await criticalSettingsAction(kind, new FormData(form));
          setError(result.error ?? "Изменения сохранены.");
          const otp = form.elements.namedItem("otp");
          if (otp instanceof HTMLInputElement) otp.value = "";
        } catch {
          setError(
            "Не удалось выполнить действие. Проверьте данные и повторите попытку со свежим кодом.",
          );
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset disabled={pending} className="critical-fields">
        <TwoFactorField />
        {children}
      </fieldset>
      {error ? <p role="status">{error}</p> : null}
    </form>
  );
}
