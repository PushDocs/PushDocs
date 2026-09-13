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

it("edits descriptions and commits numeric fields from blur or Enter", () => {
  const change = vi.fn();
  render(
    <MetadataEditor
      value={"---\ntitle: Guide\ndescription: Old\nsidebar_position: 2\n---\n\nBody"}
      onChange={change}
      readOnly={false}
      fields={parseProjectConfig().metadata}
      path="docs/guide.md"
    />,
  );
  fireEvent.change(screen.getByLabelText("Описание для поиска"), {
    target: { value: "New description" },
  });
  expect(change).toHaveBeenCalled();
  const position = screen.getByLabelText("Порядок в разделе");
  fireEvent.change(position, { target: { value: "4" } });
  fireEvent.keyDown(position, { key: "Enter" });
  fireEvent.change(position, { target: { value: "invalid" } });
  fireEvent.blur(position);
});

it("supports custom string, boolean, and number metadata without a document heading", () => {
  const fields = [
    { name: "slug", label: "Slug", type: "string" as const },
    { name: "featured", label: "Featured", type: "boolean" as const },
    { name: "weight", label: "Weight", type: "number" as const },
    { name: "custom", label: "Custom label", type: "string" as const },
  ];
  const change = vi.fn();
  render(
    <MetadataEditor
      value={"Body without heading"}
      fields={fields}
      path=""
      readOnly={false}
      onChange={change}
    />,
  );
  expect((screen.getByLabelText("Свой адрес") as HTMLInputElement).placeholder).toBe(
    "Из пути файла",
  );
  fireEvent.change(screen.getByLabelText("Featured"), { target: { value: "true" } });
  fireEvent.change(screen.getByLabelText("Featured"), { target: { value: "" } });
  fireEvent.change(screen.getByLabelText("Custom label"), { target: { value: "value" } });
  const weight = screen.getByLabelText("Weight");
  fireEvent.change(weight, { target: { value: "not-a-number" } });
  fireEvent.blur(weight);
  expect(change).toHaveBeenCalledTimes(4);
});

it("renders path and stored-value fallbacks and ignores unfinished numeric input", () => {
  const fields = [
    { name: "title", label: "Title", type: "string" as const },
    { name: "description", label: "Description", type: "string" as const },
    { name: "slug", label: "Slug", type: "string" as const },
    { name: "featured", label: "Featured", type: "boolean" as const },
    { name: "weight", label: "Weight", type: "number" as const },
  ];
  const change = vi.fn();
  render(
    <MetadataEditor
      value={"---\nslug: /guide\nfeatured: true\n---\nBody"}
      fields={fields}
      path="docs/guide.mdx"
      readOnly={false}
      onChange={change}
    />,
  );

  expect((screen.getByLabelText("Название страницы") as HTMLInputElement).placeholder).toBe(
    "guide",
  );
  expect((screen.getByLabelText("Описание для поиска") as HTMLTextAreaElement).placeholder).toBe(
    "По умолчанию — начало текста статьи",
  );
  expect(screen.getByText("/guide")).toBeTruthy();
  expect((screen.getByLabelText("Featured") as HTMLSelectElement).value).toBe("true");

  const description = screen.getByLabelText("Описание для поиска");
  fireEvent.change(description, { target: { value: "temporary" } });
  fireEvent.change(description, { target: { value: "" } });
  const weight = screen.getByLabelText("Weight") as HTMLInputElement;
  fireEvent.keyDown(weight, { key: "Escape" });
  Object.defineProperty(weight, "value", { configurable: true, value: "unfinished" });
  fireEvent.change(weight);
  fireEvent.blur(weight);
  expect(change).toHaveBeenCalledOnce();
});
