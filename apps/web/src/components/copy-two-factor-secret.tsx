"use client";

import { Check, Copy, LoaderCircle } from "lucide-react";
import { useId, useRef, useState } from "react";

export function CopyTwoFactorSecret({ value }: { value: string }) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const [status, setStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");

  async function copy() {
    /* v8 ignore next -- the button is disabled synchronously while a copy is pending. */
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
    <div className="two-factor-secret">
      <label htmlFor={id}>Ключ для ручного ввода</label>
      <div className="two-factor-secret-controls">
        <input
          id={id}
          ref={input}
          readOnly
          value={value}
          autoComplete="off"
          spellCheck={false}
          onFocus={(event) => event.currentTarget.select()}
        />
        <button
          className="pd-button pd-button--secondary"
          type="button"
          disabled={status === "copying"}
          onClick={() => void copy()}
        >
          {status === "copied" ? (
            <Check aria-hidden size={16} />
          ) : status === "copying" ? (
            <LoaderCircle aria-hidden size={16} />
          ) : (
            <Copy aria-hidden size={16} />
          )}
          {status === "copying" ? "Копируем…" : status === "copied" ? "Скопировано" : "Копировать"}
        </button>
      </div>
      {status === "copied" ? <p role="status">Ключ скопирован.</p> : null}
      {status === "error" ? (
        <p className="form-error" role="alert">
          Не удалось скопировать автоматически. Ключ выделен — нажмите Ctrl+C или ⌘C.
        </p>
      ) : null}
    </div>
  );
}
