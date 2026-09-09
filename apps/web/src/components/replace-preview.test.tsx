// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { planReplacement, ReplacePreview } from "./replace-preview";

afterEach(cleanup);
it("plans literal replacements without interpreting dollar signs or changing line endings", () => {
  expect(planReplacement("A\r\nA\r\n", "A", "$&")).toEqual({
    before: "A\r\nA\r\n",
    after: "$&\r\n$&\r\n",
    count: 2,
  });
  expect(planReplacement("aaa", "aa", "")).toMatchObject({ after: "a", count: 1 });
  expect(planReplacement("abc", "", "x")).toMatchObject({ after: "abc", count: 0 });
});
it("shows every replacement before applying, and cancellation leaves the document unchanged", () => {
  const apply = vi.fn(),
    cancel = vi.fn();
  render(
    <ReplacePreview
      source={"old\ncontext\nold"}
      find="old"
      replacement="new"
      readOnly={false}
      onApply={apply}
      onCancel={cancel}
    />,
  );
  expect(screen.getAllByText("old")).toHaveLength(2);
  expect(screen.getAllByText("new")).toHaveLength(2);
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(cancel).toHaveBeenCalledOnce();
  expect(apply).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Заменить все (2)" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith("old\ncontext\nold", "new\ncontext\nnew");
});
it("requires a fresh preview after an external source change", () => {
  const apply = vi.fn();
  const props = {
    find: "old",
    replacement: "new",
    readOnly: false,
    onApply: apply,
    onCancel: vi.fn(),
  };
  const { rerender } = render(<ReplacePreview {...props} source="old" />);
  rerender(<ReplacePreview {...props} source="old old" />);
  expect(screen.getByRole("button", { name: "Заменить все (1)" })).toHaveProperty("disabled", true);
  expect(screen.getByRole("status").textContent).toContain("Документ изменился");
  fireEvent.click(screen.getByRole("button", { name: "Обновить предпросмотр" }));
  fireEvent.click(screen.getByRole("button", { name: "Заменить все (2)" }));
  expect(apply).toHaveBeenCalledExactlyOnceWith("old old", "new new");
});
it.each([
  ["same", "changed", true],
  ["missing", "x", false],
  ["same", "same", false],
])("blocks read-only or ineffective replacement", (find, replacement, readOnly) => {
  render(
    <ReplacePreview
      source="same"
      find={find}
      replacement={replacement}
      readOnly={readOnly}
      onApply={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByRole("button", { name: /Заменить все/ })).toHaveProperty("disabled", true);
});
it("does not apply a replacement that is too large to preview", () => {
  render(
    <ReplacePreview
      source={"old\n".repeat(11000)}
      find="old"
      replacement="new"
      readOnly={false}
      onApply={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  expect(screen.getByText(/слишком большой/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Заменить все/ })).toHaveProperty("disabled", true);
});
