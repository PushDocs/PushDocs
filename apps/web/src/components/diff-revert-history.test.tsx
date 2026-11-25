// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DiffRevertHistory, useDiffRevertHistory } from "./diff-revert-history";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
function Controls() {
  const history = useDiffRevertHistory();
  if (!history) return null;
  const record = (token: string, revision: number) =>
    history.record({
      token,
      path: "a.md",
      previousRevision: revision - 1,
      revision,
      headSha: "head",
      file: {
        path: "a.md",
        before: "old\nkeep\nlast",
        after: "old\nkeep\nlast",
        existed: true,
        binary: false,
        operation: "modify",
      },
      blocks: [{ index: 0, start: token === "first" ? 0 : 9, end: token === "first" ? 4 : 13 }],
    });
  return (
    <>
      <input aria-label="Поиск" />
      <button type="button" onClick={() => record("first", 8)}>
        Первый откат
      </button>
      <button type="button" onClick={() => record("second", 9)}>
        Второй откат
      </button>
      {history.entries.map((entry) => (
        <button
          type="button"
          key={entry.id}
          disabled={history.pending}
          onClick={() => history.undo(entry.blocks[0]?.id)}
        >
          Вернуть {entry.token}
        </button>
      ))}
    </>
  );
}
const view = () =>
  render(
    <DiffRevertHistory projectId="p" branch="fix" canWrite>
      <Controls />
    </DiffRevertHistory>,
  );
beforeEach(() => {
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(Response.json({ revision: 10, content: "new\nkeep\nlast" }));
});
afterEach(cleanup);
it("restores a selected earlier block using the current revision while keeping a later rollback", async () => {
  view();
  fireEvent.click(screen.getByText("Первый откат"));
  fireEvent.click(screen.getByText("Второй откат"));
  fireEvent.click(screen.getByText("Вернуть first"));
  await waitFor(() => expect(screen.queryByText("Вернуть first")).toBeNull());
  expect(screen.getByText("Вернуть second")).toBeTruthy();
  expect(JSON.parse(mocks.fetch.mock.calls[0]?.[1].body)).toEqual({
    branch: "fix",
    path: "a.md",
    expectedRevision: 9,
    expectedHeadSha: "head",
    restoreToken: "first",
    restoreBlocks: [0],
  });
});
it("uses Ctrl/Cmd+Z for the latest operation and preserves input undo", async () => {
  view();
  fireEvent.click(screen.getByText("Первый откат"));
  fireEvent.keyDown(screen.getByRole("textbox"), { code: "KeyZ", ctrlKey: true });
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.keyDown(document, { code: "KeyZ", key: "я", metaKey: true });
  await waitFor(() => expect(screen.queryByText("Вернуть first")).toBeNull());
  expect(mocks.fetch).toHaveBeenCalledOnce();
});
it("keeps the block on failure and does not post duplicate concurrent undo requests", async () => {
  mocks.fetch.mockResolvedValue(Response.json({ error: "conflict" }, { status: 409 }));
  view();
  fireEvent.click(screen.getByText("Первый откат"));
  fireEvent.keyDown(document, { code: "KeyZ", ctrlKey: true });
  fireEvent.keyDown(document, { code: "KeyZ", ctrlKey: true, repeat: true });
  await waitFor(() => expect(mocks.fetch).toHaveBeenCalledOnce());
  expect(screen.getByText("Вернуть first")).toBeTruthy();
});
