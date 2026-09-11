"use client";

import { Select as BaseSelect } from "@base-ui/react/select";
import clsx from "clsx";
import { Check, ChevronDown } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Button({
  className,
  tone = "secondary",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: "primary" | "secondary" | "ghost" | "danger";
}) {
  return <button className={clsx("pd-button", `pd-button--${tone}`, className)} {...props} />;
}

export interface SelectOption {
  label: string;
  value: string;
}

export function Select({
  ariaDescribedBy,
  className,
  defaultValue,
  disabled,
  id,
  label,
  name,
  onValueChange,
  options,
  required,
  value,
}: {
  ariaDescribedBy?: string;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  id?: string;
  label: string;
  name?: string;
  onValueChange?: (value: string) => void;
  options: SelectOption[];
  required?: boolean;
  value?: string;
}) {
  return (
    <BaseSelect.Root
      defaultValue={defaultValue}
      disabled={disabled}
      name={name}
      required={required}
      value={value}
      onValueChange={(next) => next !== null && onValueChange?.(next)}
    >
      <BaseSelect.Trigger
        className={clsx("pd-select", className)}
        aria-describedby={ariaDescribedBy}
        aria-label={label}
        disabled={disabled}
        id={id}
      >
        <BaseSelect.Value>
          {(selected: string | null) =>
            options.find((option) => option.value === selected)?.label ?? "Выберите значение"
          }
        </BaseSelect.Value>
        <BaseSelect.Icon>
          <ChevronDown aria-hidden size={15} />
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner className="pd-select-positioner" sideOffset={6}>
          <BaseSelect.Popup className="pd-select-popup">
            {options.map((option) => (
              <BaseSelect.Item className="pd-select-item" key={option.value} value={option.value}>
                <BaseSelect.ItemIndicator className="pd-select-check">
                  <Check aria-hidden size={14} />
                </BaseSelect.ItemIndicator>
                <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
              </BaseSelect.Item>
            ))}
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}

export function Status({
  children,
  tone,
}: {
  children: ReactNode;
  tone: "success" | "warning" | "danger" | "neutral";
}) {
  return <span className={clsx("pd-status", `pd-status--${tone}`)}>{children}</span>;
}
