// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { DiffViewer } from "./diff-viewer";

afterEach(cleanup);
it("shows colored lines, counts and a split view with aligned replacements", () => {
  const { container } = render(
    <DiffViewer before={"one\nold\nlast\n"} after={"one\nnew\nextra\nlast\n"} />,
  );
  expect(screen.getByLabelText("Добавлено строк: 2")).toBeTruthy();
  expect(screen.getByLabelText("Удалено строк: 1")).toBeTruthy();
  expect(container.querySelectorAll('.wb-diff-row[data-kind="add"]')).toHaveLength(2);
  fireEvent.click(screen.getByRole("button", { name: "Две колонки" }));
  const rows = container.querySelectorAll(".wb-diff-pair");
  expect(rows).toHaveLength(4);
  expect(rows[1]?.textContent).toContain("old");
  expect(rows[1]?.textContent).toContain("new");
  expect(rows[2]?.querySelector('[data-kind="empty"]')).toBeTruthy();
});

it("expands unchanged sections and resets them when the compared text changes", () => {
  const before = Array.from({ length: 30 }, (_, i) => `line ${i}\n`).join("");
  const after = before.replace("line 15\n", "edited\n");
  const { rerender } = render(<DiffViewer before={before} after={after} />);
  expect(screen.queryByText("line 0")).toBeNull();
  const expand = screen.getAllByRole("button", { name: /Показать строки/ }).at(0);
  if (!expand) throw new Error("Missing context control");
  fireEvent.click(expand);
  expect(screen.getByText("line 0")).toBeTruthy();
  rerender(<DiffViewer before={before} after={`${after}another\n`} />);
  expect(screen.queryByText("line 0")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Весь файл" }));
  expect(screen.getByText("line 29")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Только изменения" }));
  expect(screen.queryByText("line 0")).toBeNull();
});

it("handles unchanged, new and deleted files and displays missing final newlines", () => {
  const { rerender } = render(<DiffViewer before={"same"} after={"same"} />);
  expect(screen.getByText("Нет изменений")).toBeTruthy();
  rerender(<DiffViewer before={""} after={"new"} />);
  expect(screen.getByLabelText("Добавлено строк: 1")).toBeTruthy();
  expect(screen.getByText("Нет перевода строки в конце файла")).toBeTruthy();
  rerender(<DiffViewer before={"removed\n"} after={""} />);
  expect(screen.getByLabelText("Удалено строк: 1")).toBeTruthy();
  expect(screen.getByLabelText("Добавлено строк: 0")).toBeTruthy();
});
