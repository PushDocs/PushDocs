// @vitest-environment jsdom

import { parseProjectConfig } from "@pushdocs/content";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, expect, it, vi } from "vitest";
import { MetadataEditor } from "./metadata-editor";

vi.mock("@pushdocs/ui", () => ({
  Select: ({
    disabled,
    id,
    label,
    onValueChange,
    options,
    value,
  }: {
    disabled?: boolean;
    id?: string;
    label: string;
    onValueChange?: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value?: string;
  }) => (
    <select
      aria-label={label}
      disabled={disabled}
      id={id}
      onChange={(event) => onValueChange?.(event.target.value)}
      value={value}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

afterEach(cleanup);
function Example({ source = "# Body", readOnly = false }) {
  const [value, setValue] = useState(source);
  return (
    <>
      <MetadataEditor
        value={value}
        fields={parseProjectConfig().metadata}
        readOnly={readOnly}
        onChange={setValue}
      />
      <output>{value}</output>
    </>
  );
}
it("updates configured scalar fields and retains unknown metadata and body", () => {
  render(<Example source={"---\ntitle: Old # keep\ncustom: [one, two]\n---\n<Widget />"} />);
  fireEvent.change(screen.getByLabelText("Название страницы"), { target: { value: "New" } });
  fireEvent.change(screen.getByLabelText("Порядок в разделе"), { target: { value: "2" } });
  fireEvent.blur(screen.getByLabelText("Порядок в разделе"));
  fireEvent.change(screen.getByLabelText("Видимость на сайте"), { target: { value: "true" } });
  expect(screen.getByRole("status").textContent).toBe(
    '---\ntitle: "New" # keep\ncustom: [one, two]\nsidebar_position: 2\ndraft: true\n---\n<Widget />',
  );
});
it("marks unsupported values and syntax as source-only, with no changes for a reader", () => {
  const { rerender } = render(
    <Example source={"---\ndescription: |\n  More text\n---\n# Body"} readOnly />,
  );
  expect((screen.getByLabelText("Название страницы") as HTMLInputElement).disabled).toBe(true);
  expect(screen.getByText(/Измените это значение/)).toBeTruthy();
  rerender(
    <MetadataEditor
      value={"---javascript\n1 + 1\n---"}
      fields={parseProjectConfig().metadata}
      readOnly={false}
      onChange={() => {
        throw new Error("Must not change");
      }}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("исходник");
  expect(screen.queryByLabelText("Название страницы")).toBeNull();
});

it("shows inherited titles and actual sidebar labels without creating overrides", () => {
  const source = "---\nsidebar_label: В меню\nsidebar_position: -2\n---\n# Заголовок из текста";
  render(<Example source={source} />);
  const title = screen.getByLabelText("Название страницы") as HTMLInputElement;
  expect(title.value).toBe("");
  expect(title.placeholder).toBe("Заголовок из текста");
  expect((screen.getByLabelText("Название в меню") as HTMLInputElement).value).toBe("В меню");
  expect((screen.getByLabelText("Видимость на сайте") as HTMLSelectElement).value).toBe("false");
  expect(screen.getByRole("status").textContent).toBe(source);
  fireEvent.click(screen.getByRole("button", { name: "Сбросить: Название в меню" }));
  expect((screen.getByLabelText("Название в меню") as HTMLInputElement).placeholder).toBe(
    "Заголовок из текста",
  );
  expect(screen.getByRole("status").textContent).not.toContain("sidebar_label");
});

it("clears optional fields back to defaults and explains excluding a page", () => {
  render(<Example source={"---\ntitle: Override\nsidebar_position: 4\n---\n# Body"} />);
  fireEvent.change(screen.getByLabelText("Название страницы"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Порядок в разделе"), { target: { value: "" } });
  fireEvent.blur(screen.getByLabelText("Порядок в разделе"));
  expect(screen.getByRole("status").textContent).not.toMatch(/title:|sidebar_position:/);
  fireEvent.change(screen.getByLabelText("Видимость на сайте"), { target: { value: "true" } });
  expect(screen.getByRole("status").textContent).toContain("draft: true");
  expect(screen.getByText(/не попадёт в опубликованный сайт/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Сбросить: Видимость на сайте" }));
  expect(screen.getByRole("status").textContent).not.toContain("draft:");
});
