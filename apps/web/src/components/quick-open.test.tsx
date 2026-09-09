// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { QuickOpen, searchFiles } from "./quick-open";

afterEach(cleanup);
const files = [
  {
    path: "docs/start.mdx",
    title: "Быстрый старт",
    content: "# Старт\n\nОтправить письмо",
    status: "modify",
  },
  {
    path: "docs/archive.md",
    title: "Архив",
    content: "# Архив\nОтправить письмо",
    status: "clean",
  },
  { path: "docs/deleted.md", title: "Удалено", content: "Отправить письмо", status: "delete" },
  { path: "config.json", title: "Конфигурация", content: "Отправить письмо", status: "clean" },
];
const paths = [...files.map((file) => file.path), "static/logo.png"];
it("finds filenames and article titles, including unloaded files, without deleted drafts", () => {
  expect(searchFiles(paths, files, "БЫСТРЫЙ", false).map((file) => file.path)).toEqual([
    "docs/start.mdx",
  ]);
  expect(searchFiles(paths, files, "logo", false).map((file) => file.path)).toEqual([
    "static/logo.png",
  ]);
  expect(searchFiles(paths, files, "deleted", false)).toEqual([]);
});
it("searches article text with original line numbers and excludes configuration files", () => {
  const results = searchFiles(paths, files, "отправить", true);
  expect(results.map(({ path, line }) => ({ path, line }))).toEqual([
    { path: "docs/start.mdx", line: 3 },
    { path: "docs/archive.md", line: 2 },
  ]);
  expect(results[0]?.excerpt).toContain("Отправить письмо");
  expect(searchFiles(paths, files, " ", true)).toEqual([]);
});
it("opens the keyboard-selected search result at its matching line", () => {
  const open = vi.fn();
  render(<QuickOpen paths={paths} files={files} onOpen={open} initialContent />);
  const input = screen.getByLabelText("Поиск файлов");
  fireEvent.change(input, { target: { value: "письмо" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).toHaveBeenCalledWith("docs/archive.md", 2);
  fireEvent.change(input, { target: { value: "несуществующий" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(open).toHaveBeenCalledTimes(1);
  expect(screen.getByText("Файлы не найдены.")).toBeTruthy();
});
