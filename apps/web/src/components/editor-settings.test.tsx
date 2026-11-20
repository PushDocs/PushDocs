// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type ComponentProps, createRef } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { editorPreferences } from "../lib/editor-settings";
import { DiffViewer } from "./diff-viewer";
import { EditorSettings } from "./editor-settings";
import { FallbackSourceEditor } from "./fallback-source-editor";

vi.mock("@pushdocs/ui", () => ({
  Select: ({
    label,
    id,
    value,
    options,
    onValueChange,
  }: ComponentProps<typeof import("@pushdocs/ui").Select>) => (
    <select
      id={id}
      aria-label={label}
      value={value}
      onChange={(event) => onValueChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function editors() {
  const onChange = vi.fn();
  const view = render(
    <>
      <EditorSettings />
      <FallbackSourceEditor
        value={"long line\r\nsecond"}
        onChange={onChange}
        onSave={vi.fn()}
        onIndent={vi.fn()}
        inputRef={createRef()}
        readOnly
      />
      <DiffViewer before="before" after="after" />
    </>,
  );
  return { ...view, onChange };
}

function choose(label: string) {
  const option = screen.getByRole("option", { name: label }) as HTMLOptionElement;
  fireEvent.change(screen.getByRole("combobox", { name: "Перенос строк" }), {
    target: { value: option.value },
  });
}

it("wraps by default, shares the choice with viewers and restores it after remounting", () => {
  const view = editors();
  const input = screen.getByRole("textbox", { name: "Исходник документа" }) as HTMLTextAreaElement;
  expect(input.wrap).toBe("soft");
  input.setSelectionRange(2, 6);
  choose("Не переносить");
  expect(input.wrap).toBe("off");
  expect(input.selectionStart).toBe(2);
  expect(input.selectionEnd).toBe(6);
  expect(input.value).toBe("long line\nsecond");
  expect(view.onChange).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Сравнение изменений").getAttribute("data-word-wrap")).toBe("off");
  expect(localStorage.getItem(editorPreferences.storageKey)).toBe("off");
  view.unmount();
  editors();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).wrap).toBe("off");
  choose("Переносить");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).wrap).toBe("soft");
});

it("uses wrapping for invalid preferences and follows changes and resets from another tab", () => {
  localStorage.setItem(editorPreferences.storageKey, "invalid");
  editors();
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.wrap).toBe("soft");
  act(() => {
    localStorage.setItem(editorPreferences.storageKey, "off");
    window.dispatchEvent(new StorageEvent("storage", { key: editorPreferences.storageKey }));
  });
  expect(input.wrap).toBe("off");
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(input.wrap).toBe("soft");
});

it("keeps the shared choice when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Storage blocked");
  });
  const view = editors();
  choose("Не переносить");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).wrap).toBe("off");
  view.unmount();
  editors();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).wrap).toBe("off");
  choose("Переносить");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).wrap).toBe("soft");
});
