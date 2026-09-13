"use client";
import { Check, Copy, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";
export function CopyInvitation({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  async function copy() {
    if (pending.current) return;
    pending.current = true;
    setStatus("copying");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard unavailable");
      await Promise.race([
        navigator.clipboard.writeText(value),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Clipboard timeout")), 5000);
        }),
      ]);
      setStatus("copied");
    } catch {
      setStatus("error");
      input.current?.focus();
      input.current?.select();
    } finally {
      clearTimeout(timer);
      pending.current = false;
    }
  }
  return (
    <div className="invitation-copy">
      <div className="invitation-copy-controls">
        <input
          ref={input}
          readOnly
          value={value}
          aria-label="Ссылка приглашения"
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          className="pd-button pd-button--secondary"
          type="button"
          onClick={() => void copy()}
          disabled={status === "copying"}
        >
          {status === "copied" ? (
            <Check size={16} aria-hidden />
          ) : status === "copying" ? (
            <LoaderCircle size={16} aria-hidden />
          ) : (
            <Copy size={16} aria-hidden />
          )}
          {status === "copying"
            ? "Копируем…"
            : status === "copied"
              ? "Скопировано"
              : "Скопировать ссылку"}
        </button>
      </div>
      {status === "copied" ? (
        <p className="invitation-copy-success" role="status">
          Ссылка скопирована
        </p>
      ) : null}
      {status === "error" ? (
        <p className="invitation-copy-error" role="alert">
          Не удалось скопировать автоматически. Ссылка выделена — нажмите Ctrl+C или ⌘C.
        </p>
      ) : null}
      {status === "copying" ? <p role="status">Копируем ссылку…</p> : null}
    </div>
  );
}
