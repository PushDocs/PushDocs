// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChangeFileList } from "./change-file-list";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const files = Array.from({ length: 30 }, (_, index) => ({
  path: index === 0 ? "root.md" : `docs/file-${index}.md`,
  operation: index % 3 === 0 ? "add" : index % 3 === 1 ? "delete" : "modify",
  before: "",
  after: "",
  binary: false,
  existed: true,
}));

it("measures, scrolls, selects and disconnects a virtual file list", () => {
  const observe = vi.fn();
  const disconnect = vi.fn();
  let resize: (() => void) | undefined;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe = observe;
      disconnect = disconnect;
    },
  );
  const onSelect = vi.fn();
  const view = render(
    <ChangeFileList files={files} selectedPath="docs/file-29.md" onSelect={onSelect} />,
  );
  const list = screen.getByRole("listbox");
  Object.defineProperty(list, "clientHeight", { configurable: true, value: 96 });
  list.scrollTop = 96;
  resize?.();
  fireEvent.scroll(list);
  fireEvent.keyDown(list, { key: "Home" });
  fireEvent.keyDown(list, { key: "End" });
  fireEvent.keyDown(list, { key: "PageUp" });
  fireEvent.keyDown(list, { key: "PageDown" });
  fireEvent.keyDown(list, { key: "ArrowUp" });
  fireEvent.keyDown(list, { key: "ArrowDown" });
  fireEvent.keyDown(list, { key: "Enter" });
  expect(onSelect).toHaveBeenCalled();
  const option = screen.getAllByRole("option")[0];
  if (option) fireEvent.click(option);
  expect(document.activeElement).toBe(list);
  expect(observe).toHaveBeenCalledWith(list);
  view.unmount();
  expect(disconnect).toHaveBeenCalledOnce();
});

it("handles an empty list and environments without ResizeObserver", () => {
  vi.stubGlobal("ResizeObserver", undefined);
  const onSelect = vi.fn();
  render(<ChangeFileList files={[]} onSelect={onSelect} />);
  const list = screen.getByRole("listbox");
  fireEvent.keyDown(list, { key: "End" });
  fireEvent.keyDown(list, { key: "Unknown" });
  expect(onSelect).not.toHaveBeenCalled();
});
