// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiffViewer } from "./diff-viewer";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  act(() => window.dispatchEvent(new StorageEvent("storage", { key: null })));
  cleanup();
});
beforeEach(() => localStorage.clear());

it("shares the chosen layout across mounted comparisons and remembers it for new comparisons", () => {
  const first = render(<DiffViewer before="old" after="new" />);
  const second = render(<DiffViewer before="before" after="after" />);
  fireEvent.click(within(first.container).getByRole("button", { name: "Две колонки" }));
  for (const button of screen.getAllByRole("button", { name: "Две колонки" })) {
    expect(button.getAttribute("aria-pressed")).toBe("true");
  }
  first.unmount();
  second.unmount();
  render(<DiffViewer before="another" after="change" />);
  expect(screen.getByRole("button", { name: "Две колонки" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  fireEvent.click(screen.getByRole("button", { name: "Единый" }));
  cleanup();
  render(<DiffViewer before="another" after="change" />);
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
});

it("loads a saved layout, follows changes from other tabs and ignores invalid preferences", () => {
  localStorage.setItem("pushdocs:diff-layout", "split");
  render(<DiffViewer before="old" after="new" />);
  expect(screen.getByRole("button", { name: "Две колонки" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  act(() => {
    localStorage.setItem("pushdocs:diff-layout", "unified");
    window.dispatchEvent(new StorageEvent("storage", { key: "pushdocs:diff-layout" }));
  });
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
  act(() => {
    localStorage.setItem("pushdocs:diff-layout", "split");
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" }));
  });
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
  act(() => {
    window.dispatchEvent(new StorageEvent("storage", { key: "pushdocs:diff-layout" }));
  });
  expect(screen.getByRole("button", { name: "Две колонки" }).getAttribute("aria-pressed")).toBe(
    "true",
  );
  act(() => {
    localStorage.clear();
    window.dispatchEvent(new StorageEvent("storage", { key: null }));
  });
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
  cleanup();
  localStorage.setItem("pushdocs:diff-layout", "invalid");
  render(<DiffViewer before="old" after="new" />);
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
});

it("keeps layouts shared when browser storage is blocked", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Blocked");
  });
  const first = render(<DiffViewer before="old" after="new" />);
  render(<DiffViewer before="before" after="after" />);
  fireEvent.click(within(first.container).getByRole("button", { name: "Две колонки" }));
  for (const button of screen.getAllByRole("button", { name: "Две колонки" })) {
    expect(button.getAttribute("aria-pressed")).toBe("true");
  }
});

it("uses the shared choice when reading storage works but saving fails", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("Quota exceeded");
  });
  render(<DiffViewer before="old" after="new" />);
  fireEvent.click(screen.getByRole("button", { name: "Две колонки" }));
  render(<DiffViewer before="another" after="change" />);
  for (const button of screen.getAllByRole("button", { name: "Две колонки" })) {
    expect(button.getAttribute("aria-pressed")).toBe("true");
  }
});
it("shows colored lines, counts and a split view with aligned replacements", () => {
  const { container } = render(
    <DiffViewer before={"one\nold\nlast\n"} after={"one\nnew\nextra\nlast\n"} />,
  );
  expect(screen.getByLabelText("Добавлено строк: 2")).toBeTruthy();
  expect(screen.getByLabelText("Удалено строк: 1")).toBeTruthy();
  expect(container.querySelectorAll('.wb-diff-row[data-kind="add"]')).toHaveLength(2);
  expect(screen.queryByText("Исходный файл")).toBeNull();
  expect(screen.queryByText("Ваши изменения")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Две колонки" }));
  expect(screen.getByText("Исходный файл")).toBeTruthy();
  expect(screen.getByText("Ваши изменения")).toBeTruthy();
  const rows = container.querySelectorAll(".wb-diff-pair");
  expect(rows).toHaveLength(4);
  expect(rows[1]?.textContent).toContain("old");
  expect(rows[1]?.textContent).toContain("new");
  expect(rows[2]?.querySelector('[data-kind="empty"]')).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Единый" }));
  expect(screen.queryByText("Исходный файл")).toBeNull();
  expect(screen.queryByText("Ваши изменения")).toBeNull();
  expect(screen.getByRole("button", { name: "Единый" }).getAttribute("aria-pressed")).toBe("true");
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
