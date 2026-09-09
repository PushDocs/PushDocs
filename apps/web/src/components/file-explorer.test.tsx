// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileExplorer } from "./file-explorer";

afterEach(cleanup);
const paths = [
  "package.json",
  "docs/a.md",
  "docs/nested/b.md",
  ".gitlab/ci.yml",
  "static/logo.png",
];
function mount(selected = "docs/a.md") {
  const onOpen = vi.fn(),
    onCreate = vi.fn();
  render(
    <FileExplorer
      paths={paths}
      selected={selected}
      statuses={new Map()}
      readOnly={false}
      busy={false}
      onOpen={onOpen}
      onCreate={onCreate}
      onRefresh={vi.fn()}
    />,
  );
  return { onOpen, onCreate };
}
it("shows folders first, opens only selected ancestors and preserves actual names", () => {
  mount();
  expect(screen.getAllByRole("treeitem")[0]?.textContent).toBe(".gitlab");
  expect(screen.getByRole("treeitem", { name: "docs" }).getAttribute("aria-expanded")).toBe("true");
  expect(screen.getByRole("treeitem", { name: "nested" }).getAttribute("aria-expanded")).toBe(
    "false",
  );
  expect(screen.queryByRole("treeitem", { name: "b.md" })).toBeNull();
  fireEvent.click(screen.getByRole("treeitem", { name: "nested" }));
  expect(screen.getByRole("treeitem", { name: "b.md" }).getAttribute("aria-level")).toBe("3");
  fireEvent.click(screen.getByRole("button", { name: "Свернуть все папки" }));
  expect(screen.queryByRole("treeitem", { name: "a.md" })).toBeNull();
});
it("creates siblings in the selected folder and supports keyboard expansion", () => {
  const { onCreate, onOpen } = mount();
  fireEvent.click(screen.getByRole("treeitem", { name: "nested" }));
  fireEvent.click(screen.getByRole("button", { name: "Новый файл" }));
  expect(onCreate).toHaveBeenCalledWith("new", "docs/nested");
  fireEvent.click(screen.getByRole("treeitem", { name: "b.md" }));
  expect(onOpen).toHaveBeenCalledWith("docs/nested/b.md");
  const folder = screen.getByRole("treeitem", { name: "nested" });
  fireEvent.keyDown(folder, { key: "ArrowLeft" });
  expect(folder.getAttribute("aria-expanded")).toBe("false");
  fireEvent.keyDown(folder, { key: "ArrowRight" });
  expect(folder.getAttribute("aria-expanded")).toBe("true");
});
it("decorates changed files and collapsed ancestors without relying on color alone", () => {
  render(
    <FileExplorer
      paths={paths}
      selected="package.json"
      statuses={
        new Map([
          ["docs/nested/b.md", "add"],
          ["package.json", "modify"],
          ["static/logo.png", "delete"],
        ])
      }
      readOnly={false}
      busy={false}
      onOpen={vi.fn()}
      onCreate={vi.fn()}
      onRefresh={vi.fn()}
    />,
  );
  const docs = screen.getByRole("treeitem", { name: "docs" });
  expect(docs.dataset.status).toBe("modify");
  expect(docs.getAttribute("aria-description")).toBe("Есть изменения внутри");
  expect(screen.getByRole("treeitem", { name: "package.json" }).textContent).toContain("M");
  fireEvent.click(docs);
  fireEvent.click(screen.getByRole("treeitem", { name: "nested" }));
  const added = screen.getByRole("treeitem", { name: "b.md" });
  expect(added.dataset.status).toBe("add");
  expect(added.textContent).toContain("A");
  expect(added.title).toContain("Новый файл");
});
