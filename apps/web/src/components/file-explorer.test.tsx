// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FileExplorer } from "./file-explorer";

afterEach(cleanup);
it("remembers expanded folders and exposes actions for the clicked file", () => {
  sessionStorage.clear();
  const action = vi.fn();
  const props = {
    paths,
    selected: "docs/a.md",
    statuses: new Map<string, string>(),
    readOnly: false,
    busy: false,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onRefresh: vi.fn(),
    storageKey: "folders:main",
    onAction: action,
    canEdit: (path: string) => path !== "package.json",
  };
  render(<FileExplorer {...props} />);
  fireEvent.click(screen.getByRole("treeitem", { name: "nested" }));
  cleanup();
  render(<FileExplorer {...props} />);
  expect(screen.getByRole("treeitem", { name: "b.md" })).toBeTruthy();
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: "b.md" }), {
    clientX: 120,
    clientY: 200,
  });
  fireEvent.click(screen.getByRole("menuitem", { name: "Переименовать" }));
  expect(action).toHaveBeenCalledWith("rename", "docs/nested/b.md");
  expect(screen.queryByRole("menu")).toBeNull();
  fireEvent.contextMenu(screen.getByRole("treeitem", { name: "package.json" }));
  expect(screen.getByRole("menuitem", { name: "Переименовать" })).toHaveProperty("disabled", true);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
});
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

it("uploads to hovered folders, a file's parent or the root without changing the selected file", () => {
  const upload = vi.fn();
  const open = vi.fn();
  render(
    <FileExplorer
      paths={paths}
      selected="docs/a.md"
      statuses={new Map()}
      readOnly={false}
      busy={false}
      onOpen={open}
      onCreate={vi.fn()}
      onRefresh={vi.fn()}
      onUpload={upload}
    />,
  );
  const files = [new File(["one"], "one.md"), new File(["two"], "two.png")];
  const dataTransfer = { files, types: ["Files"], dropEffect: "none" };
  const nested = screen.getByRole("treeitem", { name: "nested" });
  fireEvent.dragOver(nested.querySelector("svg") ?? nested, { dataTransfer });
  expect(nested.dataset.dropTarget).toBe("true");
  expect(screen.getByRole("status").textContent).toBe("Загрузить в docs/nested");
  fireEvent.drop(nested, { dataTransfer });
  expect(upload).toHaveBeenLastCalledWith(files, "docs/nested");
  expect(screen.queryByRole("status")).toBeNull();
  fireEvent.drop(screen.getByRole("treeitem", { name: "a.md" }), { dataTransfer });
  expect(upload).toHaveBeenLastCalledWith(files, "docs");
  fireEvent.drop(screen.getByRole("tree"), { dataTransfer });
  expect(upload).toHaveBeenLastCalledWith(files, "");
  expect(open).not.toHaveBeenCalled();
});

it("blocks drops while read-only or busy and ignores internal tab drags", () => {
  const upload = vi.fn();
  const props = {
    paths,
    selected: "docs/a.md",
    statuses: new Map<string, string>(),
    readOnly: true,
    busy: false,
    onOpen: vi.fn(),
    onCreate: vi.fn(),
    onRefresh: vi.fn(),
    onUpload: upload,
  };
  const view = render(<FileExplorer {...props} />);
  const dataTransfer = { files: [new File(["x"], "x.md")], types: ["Files"], dropEffect: "copy" };
  fireEvent.dragOver(screen.getByRole("tree"), { dataTransfer });
  expect(dataTransfer.dropEffect).toBe("none");
  fireEvent.drop(screen.getByRole("tree"), { dataTransfer });
  view.rerender(<FileExplorer {...props} readOnly={false} busy />);
  fireEvent.drop(screen.getByRole("tree"), { dataTransfer });
  view.rerender(<FileExplorer {...props} readOnly={false} />);
  fireEvent.drop(screen.getByRole("tree"), {
    dataTransfer: { ...dataTransfer, types: ["text/plain"] },
  });
  expect(upload).not.toHaveBeenCalled();
});

it("opens a hovered folder and rejects directory drops instead of creating an empty file", async () => {
  vi.useFakeTimers();
  const upload = vi.fn();
  try {
    render(
      <FileExplorer
        paths={paths}
        selected="docs/a.md"
        statuses={new Map()}
        readOnly={false}
        busy={false}
        onOpen={vi.fn()}
        onCreate={vi.fn()}
        onRefresh={vi.fn()}
        onUpload={upload}
      />,
    );
    const folder = screen.getByRole("treeitem", { name: "nested" });
    fireEvent.dragOver(folder, { dataTransfer: { types: ["Files"] } });
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    expect(folder.getAttribute("aria-expanded")).toBe("true");
    fireEvent.drop(folder, {
      dataTransfer: {
        types: ["Files"],
        files: [new File([], "directory.json")],
        items: [{ webkitGetAsEntry: () => ({ isDirectory: true }) }],
      },
    });
    expect(upload).not.toHaveBeenCalled();
    expect(screen.getByRole("status").textContent).toContain("перетащите нужные файлы");
  } finally {
    vi.useRealTimers();
  }
});

it("hides internal .pushdocs files even when selected and creates files outside the hidden folder", () => {
  const onCreate = vi.fn();
  const props = {
    paths: [
      ".pushdocs/config.json",
      ".pushdocs/cache/data.json",
      ".pushdocs-notes.md",
      ".gitlab/ci.yml",
    ],
    selected: ".pushdocs/config.json",
    statuses: new Map([[".pushdocs/config.json", "add"]]),
    readOnly: false,
    busy: false,
    onOpen: vi.fn(),
    onCreate,
    onRefresh: vi.fn(),
  };
  const view = render(<FileExplorer {...props} />);
  expect(screen.queryByRole("treeitem", { name: ".pushdocs" })).toBeNull();
  expect(screen.queryByRole("treeitem", { name: /config.json/ })).toBeNull();
  expect(screen.getByRole("treeitem", { name: ".pushdocs-notes.md" })).toBeTruthy();
  expect(screen.getByRole("treeitem", { name: ".gitlab" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Новый файл" }));
  expect(onCreate).toHaveBeenCalledWith("new", "");
  view.rerender(<FileExplorer {...props} paths={[".pushdocs/config.json"]} />);
  expect(screen.getByText("Нет файлов")).toBeTruthy();
});
