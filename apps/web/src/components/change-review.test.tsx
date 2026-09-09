// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChangeReview } from "./change-review";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
afterEach(cleanup);
it("navigates between text diffs and keeps the source branch in the edit link", () => {
  render(
    <ChangeReview
      projectId="p"
      branch="docs/fix"
      files={[
        {
          path: "docs/a.md",
          operation: "modify",
          before: "Before",
          after: "After",
          binary: false,
          existed: true,
        },
        {
          path: "docs/new.md",
          operation: "add",
          before: "",
          after: "New article",
          binary: false,
          existed: false,
        },
      ]}
    />,
  );
  expect(screen.getByText("Before")).toBeTruthy();
  expect(screen.getByText("After")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Предыдущий файл" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("button", { name: "Следующий файл" }));
  expect(screen.getByText("New article")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Открыть файл" }).getAttribute("href")).toBe(
    "/projects/p/documents?branch=docs%2Ffix&path=docs%2Fnew.md",
  );
  expect(screen.getByRole("button", { name: "Следующий файл" })).toHaveProperty("disabled", true);
  fireEvent.click(screen.getByRole("option", { name: "docs/a.md M" }));
  expect(screen.getByText("Before")).toBeTruthy();
});
it("compares the Git image with its replacement, and handles added and deleted images", () => {
  render(
    <ChangeReview
      projectId="p"
      branch="fix"
      files={[
        {
          path: "static/a.png",
          operation: "modify",
          before: "",
          after: "",
          binary: true,
          existed: true,
        },
        {
          path: "static/new.png",
          operation: "add",
          before: "",
          after: "",
          binary: true,
          existed: false,
        },
        {
          path: "static/deleted.png",
          operation: "delete",
          before: "",
          after: "",
          binary: true,
          existed: true,
        },
      ]}
    />,
  );
  expect(screen.getByAltText("До изменения").getAttribute("src")).toContain("version=git");
  expect(screen.getByAltText("После изменения").getAttribute("src")).not.toContain("version=");
  fireEvent.click(screen.getByRole("button", { name: "Следующий файл" }));
  expect(screen.getByText("Файла не было")).toBeTruthy();
  expect(screen.queryByAltText("До изменения")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Следующий файл" }));
  expect(screen.getByText("Файл удалён")).toBeTruthy();
  expect(screen.queryByAltText("После изменения")).toBeNull();
});

const manyFiles = Array.from({ length: 10_000 }, (_, index) => ({
  path: `docs/section-${Math.floor(index / 100)}/file-${index}.md`,
  operation: "modify",
  before: `Before file ${index}`,
  after: `After file ${index}`,
  binary: false,
  existed: true,
}));

it("virtualizes 10,000 files and only mounts the selected diff", () => {
  render(<ChangeReview projectId="p" branch="fix" files={manyFiles} />);
  expect(screen.getAllByRole("option").length).toBeLessThan(30);
  expect(screen.getAllByRole("region", { name: "Сравнение изменений" })).toHaveLength(1);
  expect(screen.getByText("After file 0")).toBeTruthy();
  const list = screen.getByRole("listbox", { name: "Изменённые файлы" });
  fireEvent.scroll(list, { target: { scrollTop: 480_000 } });
  expect(screen.queryByRole("option", { name: "docs/section-0/file-0.md M" })).toBeNull();
  expect(screen.getAllByRole("option").length).toBeLessThan(30);
  const last = screen.getByRole("option", { name: "docs/section-99/file-9999.md M" });
  expect(last.getAttribute("aria-posinset")).toBe("10000");
  expect(last.getAttribute("aria-setsize")).toBe("10000");
  fireEvent.click(last);
  expect(screen.getByText("After file 9999")).toBeTruthy();
  expect(screen.queryByText("After file 0")).toBeNull();
  expect(document.activeElement).toBe(list);
  expect(screen.getAllByRole("region", { name: "Сравнение изменений" })).toHaveLength(1);
});

it("navigates to unmounted files using the keyboard and reveals the selection", () => {
  render(<ChangeReview projectId="p" branch="fix" files={manyFiles} />);
  const list = screen.getByRole("listbox", { name: "Изменённые файлы" });
  fireEvent.keyDown(list, { key: "End" });
  expect(screen.getByText("After file 9999")).toBeTruthy();
  expect(list.scrollTop).toBeGreaterThan(470_000);
  const active = screen.getByRole("option", { name: "docs/section-99/file-9999.md M" });
  expect(list.getAttribute("aria-activedescendant")).toBe(active.id);
  fireEvent.keyDown(list, { key: "ArrowUp" });
  expect(screen.getByText("After file 9998")).toBeTruthy();
  fireEvent.keyDown(list, { key: "Home" });
  expect(list.scrollTop).toBe(0);
  fireEvent.keyDown(list, { key: "PageDown" });
  expect(screen.getByText("After file 10")).toBeTruthy();
  fireEvent.keyDown(list, { key: "PageUp" });
  expect(screen.getByText("After file 0")).toBeTruthy();
  fireEvent.keyDown(list, { key: "ArrowUp" });
  expect(screen.getByText("After file 0")).toBeTruthy();
});

it("searches by path across the whole list, navigates results and recovers from no matches", () => {
  render(<ChangeReview projectId="p" branch="fix" files={manyFiles} />);
  const search = screen.getByRole("searchbox", { name: "Найти изменённый файл" });
  fireEvent.change(search, { target: { value: "SECTION-99/file-999" } });
  expect(screen.getAllByRole("option")).toHaveLength(10);
  expect(screen.getByText("After file 9990")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Следующий файл" }));
  expect(screen.getByText("After file 9991")).toBeTruthy();
  fireEvent.change(search, { target: { value: "missing-file" } });
  expect(screen.getByRole("status").textContent).toBe("Файлы не найдены");
  expect(screen.queryByRole("region", { name: "Сравнение изменений" })).toBeNull();
  fireEvent.change(search, { target: { value: "" } });
  expect(screen.getByText("After file 9991")).toBeTruthy();
  expect(
    screen
      .getByRole("option", { name: "docs/section-99/file-9991.md M" })
      .getAttribute("aria-selected"),
  ).toBe("true");
});

it("keeps selection by path when files reorder and selects a remaining file after removal", () => {
  const view = render(<ChangeReview projectId="p" branch="fix" files={manyFiles.slice(0, 3)} />);
  fireEvent.click(screen.getByRole("button", { name: "Следующий файл" }));
  view.rerender(
    <ChangeReview projectId="p" branch="fix" files={manyFiles.slice(0, 3).reverse()} />,
  );
  expect(screen.getByText("After file 1")).toBeTruthy();
  view.rerender(<ChangeReview projectId="p" branch="fix" files={manyFiles.slice(2, 3)} />);
  expect(screen.getByText("After file 2")).toBeTruthy();
  view.rerender(<ChangeReview projectId="p" branch="fix" files={[]} />);
  expect(screen.queryByRole("region", { name: "Проверка изменений" })).toBeNull();
});

it("offers rollback only for editable changes, including admin-only configuration", () => {
  const config = {
    path: ".pushdocs/config.json",
    operation: "modify",
    before: "{}",
    after: '{"version": 1}',
    binary: false,
    existed: true,
  };
  const view = render(<ChangeReview projectId="p" branch="fix" files={[config]} />);
  expect(screen.queryByRole("button", { name: "Откатить изменения" })).toBeNull();
  view.rerender(
    <ChangeReview
      projectId="p"
      branch="fix"
      files={[config]}
      revertContext={{ revision: 1, ownerId: "user", canEditConfig: false }}
    />,
  );
  expect(screen.queryByRole("button", { name: "Откатить изменения" })).toBeNull();
  view.rerender(
    <ChangeReview
      projectId="p"
      branch="fix"
      files={[config]}
      revertContext={{ revision: 1, ownerId: "user", canEditConfig: true }}
    />,
  );
  expect(screen.getByRole("button", { name: "Откатить изменения" })).toBeTruthy();
});
