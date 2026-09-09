// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey, readDraft, writeDraft } from "./draft-storage";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import { RevertFile } from "./revert-file";

const props = {
  projectId: "p",
  branch: "docs/fix",
  path: "docs/a.md",
  existed: true,
  operation: "modify",
  revision: 7,
  ownerId: "user",
};
const key = draftKey("p", "docs/fix", "docs/a.md", "user");
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(Response.json({ reverted: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
function confirm() {
  fireEvent.click(screen.getByRole("button", { name: "Откатить изменения" }));
}
it("requires confirmation and leaves drafts unchanged on cancel", () => {
  writeDraft(key, "draft", "base");
  render(<RevertFile {...props} />);
  confirm();
  expect(screen.getByRole("region", { name: "Подтверждение отката" }).textContent).toContain(
    "docs/a.md",
  );
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(mocks.fetch).not.toHaveBeenCalled();
  expect(readDraft(key)?.text).toBe("draft");
});
it("reverts only the confirmed file, clears its recovery copy and refreshes changes", async () => {
  writeDraft(key, "draft", "base");
  const other = draftKey("p", "docs/fix", "docs/b.md", "user");
  writeDraft(other, "other", "base");
  render(<RevertFile {...props} />);
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "Откатить файл" }));
  await screen.findByRole("button", { name: "Изменения отменены" });
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/api/projects/p/changes",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ branch: "docs/fix", path: "docs/a.md", expectedRevision: 7 }),
    }),
  );
  expect(readDraft(key)).toBeUndefined();
  expect(readDraft(other)?.text).toBe("other");
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
});
it("keeps the draft on failure and allows retry", async () => {
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: "Нет доступа" }, { status: 403 }));
  writeDraft(key, "draft", "base");
  render(<RevertFile {...props} />);
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "Откатить файл" }));
  expect((await screen.findByRole("alert")).textContent).toBe("Нет доступа");
  expect(readDraft(key)?.text).toBe("draft");
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Откатить файл" }));
  await screen.findByRole("button", { name: "Изменения отменены" });
});
it("blocks stale confirmation after a refresh or server conflict", async () => {
  const view = render(<RevertFile {...props} />);
  confirm();
  view.rerender(<RevertFile {...props} revision={8} />);
  expect(screen.queryByRole("button", { name: "Откатить файл" })).toBeNull();
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  confirm();
  mocks.fetch.mockResolvedValueOnce(Response.json({ error: "conflict" }, { status: 409 }));
  fireEvent.click(screen.getByRole("button", { name: "Откатить файл" }));
  await screen.findByRole("alert");
  expect(screen.queryByRole("button", { name: "Откатить файл" })).toBeNull();
  expect(mocks.fetch).toHaveBeenCalledTimes(1);
});
it("prevents duplicate submissions while reverting", async () => {
  let resolve: (value: Response) => void = () => {};
  mocks.fetch.mockReturnValueOnce(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  render(<RevertFile {...props} />);
  confirm();
  fireEvent.click(screen.getByRole("button", { name: "Откатить файл" }));
  expect(screen.getByRole("button", { name: "Откатываем…" })).toHaveProperty("disabled", true);
  await act(async () => resolve(Response.json({ reverted: true })));
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it.each([
  [false, "add", "Новый файл будет удалён"],
  [true, "delete", "Удаление будет отменено"],
] as const)("explains the rollback for %s / %s", (existed, operation, message) => {
  render(<RevertFile {...props} existed={existed} operation={operation} />);
  confirm();
  expect(screen.getByRole("region", { name: "Подтверждение отката" }).textContent).toContain(
    message,
  );
});
