// @vitest-environment jsdom
import { reviewDescriptionMaxLength } from "@pushdocs/contracts";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ReviewDescription } from "./review-description";

afterEach(cleanup);

it.each([
  {
    value: "",
    start: 0,
    end: 0,
    expected: "[Текст]()",
    selection: "Текст",
    cursor: 1,
  },
  {
    value: "До  после",
    start: 3,
    end: 3,
    expected: "До [Текст]() после",
    selection: "Текст",
    cursor: 4,
  },
  {
    value: "Тикет DOC-123\nКомментарий",
    start: 6,
    end: 13,
    expected: "Тикет [DOC-123]()\nКомментарий",
    selection: "",
    cursor: 16,
  },
])("inserts a Markdown link into $value without submitting the form", (scenario) => {
  const { container } = render(
    <form>
      <ReviewDescription reviewLabel="PR" />
    </form>,
  );
  const field = screen.getByRole<HTMLTextAreaElement>("textbox", {
    name: "Описание PR (необязательно)",
  });
  fireEvent.input(field, { target: { value: scenario.value } });
  field.setSelectionRange(scenario.start, scenario.end);
  const button = screen.getByRole("button", { name: "Добавить ссылку" });
  expect(button).toHaveProperty("type", "button");
  fireEvent.click(button);
  expect(field.value).toBe(scenario.expected);
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(scenario.cursor);
  expect(field.value.slice(field.selectionStart, field.selectionEnd)).toBe(scenario.selection);
  expect(new FormData(container.querySelector("form") as HTMLFormElement).get("description")).toBe(
    scenario.expected,
  );
});

it("preserves the description when a link would exceed the limit and explains why", () => {
  render(<ReviewDescription reviewLabel="MR" />);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox");
  const value = "x".repeat(reviewDescriptionMaxLength);
  fireEvent.input(field, { target: { value } });
  fireEvent.click(screen.getByRole("button", { name: "Добавить ссылку" }));
  expect(field.value).toBe(value);
  expect(screen.getByText("Недостаточно места для ссылки. Сократите описание.")).toBeTruthy();

  fireEvent.input(field, { target: { value: value.slice("[Текст]()".length) } });
  fireEvent.click(screen.getByRole("button", { name: "Добавить ссылку" }));
  expect(field.value.length).toBe(reviewDescriptionMaxLength);
  expect(field.value.endsWith("[Текст]()")).toBe(true);
  expect(screen.getByText("Поддерживается Markdown")).toBeTruthy();
});

it("disables the field and insertion together", () => {
  render(<ReviewDescription reviewLabel="MR" disabled />);
  const field = screen.getByRole<HTMLTextAreaElement>("textbox");
  const button = screen.getByRole("button", { name: "Добавить ссылку" });
  expect(field.disabled).toBe(true);
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  expect(field.value).toBe("");
});
