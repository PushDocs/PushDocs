// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentTabs } from "./document-tabs";

afterEach(cleanup);
function mount() {
  const onReorder = vi.fn(),
    onOpen = vi.fn(),
    onClose = vi.fn();
  render(
    <DocumentTabs
      tabs={["docs/a.md", "docs/b.md", "docs/c.md"]}
      selected="docs/b.md"
      statuses={new Map()}
      onReorder={onReorder}
      onOpen={onOpen}
      onClose={onClose}
    />,
  );
  return { onReorder, onOpen, onClose };
}
function transfer() {
  return { effectAllowed: "", dropEffect: "", setData: vi.fn(), setDragImage: vi.fn() };
}
it.each([
  ["a.md", "c.md", 190, ["docs/b.md", "docs/c.md", "docs/a.md"]],
  ["c.md", "a.md", 110, ["docs/c.md", "docs/a.md", "docs/b.md"]],
])("moves %s relative to %s without opening or closing files", (source, target, clientX, order) => {
  const { onReorder, onOpen, onClose } = mount();
  const dragged = screen.getByRole("tab", { name: source });
  const destination = screen.getByRole("tab", { name: target }).parentElement as HTMLElement;
  vi.spyOn(destination, "getBoundingClientRect").mockReturnValue({
    left: 100,
    width: 100,
  } as DOMRect);
  const dataTransfer = transfer();
  fireEvent.dragStart(dragged, { dataTransfer });
  const over = new MouseEvent("dragover", { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(over, "dataTransfer", { value: dataTransfer });
  fireEvent(destination, over);
  expect(destination.dataset.drop).toBe(clientX > 150 ? "after" : "before");
  const drop = new MouseEvent("drop", { bubbles: true, cancelable: true, clientX });
  Object.defineProperty(drop, "dataTransfer", { value: dataTransfer });
  fireEvent(destination, drop);
  expect(onReorder).toHaveBeenCalledExactlyOnceWith(order);
  expect(onOpen).not.toHaveBeenCalled();
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole("tab", { name: "b.md" }).getAttribute("aria-selected")).toBe("true");
  expect(destination.dataset.drop).toBeUndefined();
});
it("ignores external drags, cancelled drags and dropping on the source tab", () => {
  const { onReorder } = mount();
  const source = screen.getByRole("tab", { name: "a.md" });
  const destination = screen.getByRole("tab", { name: "b.md" });
  const dataTransfer = transfer();
  fireEvent.drop(destination, { dataTransfer });
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.drop(source, { dataTransfer });
  expect(onReorder).not.toHaveBeenCalled();
  fireEvent.dragStart(source, { dataTransfer });
  fireEvent.dragOver(destination, { dataTransfer });
  fireEvent.dragEnd(source, { dataTransfer });
  fireEvent.drop(destination, { dataTransfer });
  expect(onReorder).not.toHaveBeenCalled();
  expect(destination.parentElement?.getAttribute("data-drop")).toBeNull();
});
it("keeps closing separate from selection and supports keyboard reordering", () => {
  const { onClose, onOpen, onReorder } = mount();
  fireEvent.click(screen.getByRole("button", { name: "Закрыть docs/b.md" }));
  expect(onClose).toHaveBeenCalledExactlyOnceWith("docs/b.md");
  expect(onOpen).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByRole("tab", { name: "b.md" }), {
    altKey: true,
    shiftKey: true,
    key: "ArrowRight",
  });
  expect(onReorder).toHaveBeenCalledExactlyOnceWith(["docs/a.md", "docs/c.md", "docs/b.md"]);
});
