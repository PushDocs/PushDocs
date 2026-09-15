"use client";

import { type ReactNode, useRef, useState } from "react";
import { criticalSettingsAction, twoFactorStatusAction } from "@/app/actions";
import { useSettingsModal } from "./settings-modal";
import { TwoFactorField } from "./two-factor-field";

export function CriticalForm({
  kind,
  action,
  className,
  children,
  onSuccess,
  description,
}: {
  description?: string;
  kind?: string;
  action?: (data: FormData) => Promise<{ ok: boolean; message: string }>;
  className?: string;
  children: ReactNode;
  onSuccess?: () => void;
}) {
  const modal = useSettingsModal();
  const [summary, setSummary] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [step, setStep] = useState<"edit" | "verify">("edit");
  const data = useRef<FormData | null>(null);
  return (
    <form
      className={className}
      onSubmit={async (event) => {
        event.preventDefault();
        if (pending || modal.pending) return;
        const form = event.currentTarget;
        setPending(true);
        modal.setPending(true);
        setMessage("");
        setFailed(false);
        try {
          if (step === "edit") {
            data.current = new FormData(form);
            const labels: Record<string, string> = {
              createConnection: "Создать подключение",
              deleteConnection: "Удалить подключение",
              createProject: "Импортировать проект",
              updateProject: "Сохранить проект",
              deleteProject: "Удалить проект",
              changePassword: "Сменить пароль",
            };
            const objectName = data.current.get("name") ?? data.current.get("confirmation");
            setSummary(
              description ??
                `${labels[kind ?? ""] ?? "Сохранить настройки"}${objectName ? `: ${objectName}` : ""}`,
            );
            if (await twoFactorStatusAction()) {
              setStep("verify");
              return;
            }
          }
          if (!data.current) return;
          if (step === "verify") {
            data.current.set("otp", String(new FormData(form).get("otp") ?? ""));
          }
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
            modal.saved();
            setStep("edit");
            data.current = null;
            onSuccess?.();
          }
        } catch {
          setFailed(true);
          setMessage("Не удалось выполнить действие. Повторите попытку.");
        } finally {
          setPending(false);
          modal.setPending(false);
        }
      }}
    >
      {pending && step === "edit" ? <p role="status">Проверяем возможность сохранения…</p> : null}
      <fieldset
        disabled={pending || modal.pending || step !== "edit"}
        hidden={step !== "edit"}
        className="critical-fields"
      >
        {children}
      </fieldset>
      {step === "verify" ? (
        <fieldset disabled={pending || modal.pending} className="critical-fields">
          <h3>{summary}</h3>
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
      {message ? <p role={failed ? "alert" : "status"}>{message}</p> : null}
    </form>
  );
}
