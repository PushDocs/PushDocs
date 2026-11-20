"use client";
import { reviewDescriptionMaxLength } from "@pushdocs/contracts";
import { Link } from "lucide-react";
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

const markdownLinkTemplate = { text: "Текст", url: "" } as const;

export function ReviewDescription({
  reviewLabel,
  disabled = false,
}: {
  reviewLabel: string;
  disabled?: boolean;
}) {
  const id = useId();
  const ref = useRef<HTMLTextAreaElement>(null);
  const { pending } = useFormStatus();
  const [limitReached, setLimitReached] = useState(false);
  const unavailable = disabled || pending;
  const insertLink = () => {
    const field = ref.current;
    if (!field || unavailable) return;
    const { selectionStart: start, selectionEnd: end, value } = field;
    const selected = value.slice(start, end);
    const text = selected || markdownLinkTemplate.text;
    const link = `[${text}](${markdownLinkTemplate.url})`;
    if (value.length - (end - start) + link.length > reviewDescriptionMaxLength) {
      setLimitReached(true);
      return;
    }
    field.setRangeText(link, start, end, "end");
    const offset = selected ? start + text.length + 3 : start + 1;
    field.focus();
    field.setSelectionRange(
      offset,
      offset + (selected ? markdownLinkTemplate.url.length : text.length),
    );
    field.dispatchEvent(new Event("input", { bubbles: true }));
  };
  return (
    <div className="review-description">
      <div className="review-description-heading">
        <label htmlFor={id}>Описание {reviewLabel} (необязательно)</label>
        <button
          type="button"
          className="pd-button pd-button--ghost"
          disabled={unavailable}
          onClick={insertLink}
        >
          <Link aria-hidden size={14} /> Добавить ссылку
        </button>
      </div>
      <textarea
        id={id}
        ref={ref}
        name="description"
        placeholder="Ссылка на тикет и комментарий к изменениям"
        maxLength={reviewDescriptionMaxLength}
        disabled={unavailable}
        aria-describedby={`${id}-note`}
        onInput={() => setLimitReached(false)}
      />
      <span id={`${id}-note`} className="field-note" aria-live="polite">
        {limitReached
          ? "Недостаточно места для ссылки. Сократите описание."
          : "Поддерживается Markdown"}
      </span>
    </div>
  );
}
