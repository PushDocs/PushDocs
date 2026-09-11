"use client";

import { type ReactNode, useRef, useState } from "react";
import { criticalSettingsAction, twoFactorStatusAction } from "@/app/actions";
import { TwoFactorField } from "./two-factor-field";

export function CriticalForm({
  kind,
  action,
  className,
  children,
  onSuccess,
}: {
  kind?: string;
  action?: (data: FormData) => Promise<{ ok: boolean; message: string }>;
  className?: string;
  children: ReactNode;
  onSuccess?: () => void;
}) {
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<"edit" | "verify" | "setup">("edit");
  const data = useRef<FormData | null>(null);
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending) return;
        const form = event.currentTarget;
        setPending(true);
        setMessage("");
        setFailed(false);
        try {
          if (step === "edit") {
            data.current = new FormData(form);
            setStep((await twoFactorStatusAction()) ? "verify" : "setup");
            return;
          }
          if (step !== "verify" || !data.current) return;
          data.current.set("otp", String(new FormData(form).get("otp") ?? ""));
          const result = action
            ? await action(data.current)
            : await criticalSettingsAction(kind ?? "", data.current).then((result) => ({
                ok: !result.error,
                message: result.error ?? "Изменения сохранены.",
              }));
          setFailed(!result.ok);
          setMessage(result.message);
          const otp = form.elements.namedItem("otp");
          if (otp instanceof HTMLInputElement) otp.value = "";
          if (result.ok) {
            setStep("edit");
            data.current = null;
            onSuccess?.();
          }
        } catch {
          setFailed(true);
          setMessage("Не удалось выполнить действие. Повторите попытку.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset
        disabled={pending || step !== "edit"}
        hidden={step !== "edit"}
        className="critical-fields"
      >
        {children}
      </fieldset>
      {step === "verify" ? (
        <fieldset disabled={pending} className="critical-fields">
          <h3>Подтвердите действие</h3>
          <TwoFactorField />
          <div className="settings-modal-actions">
            <button type="button" className="pd-button" onClick={() => setStep("edit")}>
              Назад
            </button>
            <button type="submit" className="pd-button pd-button--primary">
              {pending ? "Проверяем…" : "Подтвердить"}
            </button>
          </div>
        </fieldset>
      ) : null}
      {step === "setup" ? (
        <div role="status">
          <h3>Подключите двухфакторную аутентификацию</h3>
          <p>
            Для этого действия нужен код из приложения-аутентификатора. Сначала настройте его в
            профиле.
          </p>
          <a href="/settings/profile" target="_blank" rel="noreferrer">
            Настроить 2FA в профиле
          </a>
          <button type="button" className="pd-button" onClick={() => setStep("edit")}>
            Вернуться к форме
          </button>
        </div>
      ) : null}
      {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}
