// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { draftKey, readDraft, writeDraft } from "./draft-storage";
import { RevertDiff } from "./revert-diff";

const mocks = vi.hoisted(() => ({ router: { refresh: vi.fn() }, fetch: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
const props = {
  projectId: "p",
  branch: "fix",
  path: "docs/a.md",
  before: "old\nkeep\nlast",
  after: "new\nkeep\nchanged",
  revision: 7,
  headSha: "head",
  ownerId: "user",
};
const key = draftKey("p", "fix", "docs/a.md", "user");
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("fetch", mocks.fetch);
  mocks.fetch.mockResolvedValue(Response.json({ content: "old\nkeep\nchanged", revision: 8 }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
const choose = () =>
  fireEvent.click(screen.getAllByRole("button", { name: "Откатить строку" })[0] as HTMLElement);
const confirm = () => fireEvent.click(screen.getByRole("button", { name: "Подтвердить откат" }));
const revert = () => {
  choose();
  confirm();
};

it("saves only the clicked hunk, clears its matching recovery copy and refreshes", async () => {
  writeDraft(key, props.after, props.before);
  const other = draftKey("p", "fix", "docs/b.md", "user");
  writeDraft(other, "other", "base");
  render(<RevertDiff {...props} />);
  revert();
  await screen.findByText("Фрагмент отменён.");
  expect(mocks.fetch).toHaveBeenCalledWith(
    "/api/projects/p/changes",
    expect.objectContaining({
      body: JSON.stringify({
        branch: "fix",
        path: "docs/a.md",
        expectedRevision: 7,
        expectedHeadSha: "head",
        lineIds: [0, 1],
      }),
    }),
  );
  expect(readDraft(key)).toBeUndefined();
  expect(readDraft(other)?.text).toBe("other");
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  expect(screen.getAllByRole("button", { name: "Откатить строку" })[0]).toHaveProperty(
    "disabled",
    true,
  );
});

it("preserves recovery edits absent from the displayed diff", async () => {
  writeDraft(key, "unsaved newer edits", props.after);
  render(<RevertDiff {...props} />);
  revert();
  await screen.findByText("Фрагмент отменён.");
  expect(readDraft(key)?.text).toBe("unsaved newer edits");
});

it("keeps the diff and draft on failure and permits retry", async () => {
  mocks.fetch.mockResolvedValueOnce(new Response("failed", { status: 500 }));
  writeDraft(key, props.after, props.before);
  render(<RevertDiff {...props} />);
  revert();
  expect((await screen.findByRole("alert")).textContent).toBe("Не удалось откатить строки.");
  expect(readDraft(key)?.text).toBe(props.after);
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  confirm();
  await screen.findByText("Фрагмент отменён.");
});

it("blocks all hunk controls during the request and after a revision conflict", async () => {
  let resolve: (response: Response) => void = () => {};
  mocks.fetch.mockReturnValueOnce(
    new Promise<Response>((done) => {
      resolve = done;
    }),
  );
  render(<RevertDiff {...props} />);
  revert();
  for (const button of screen.getAllByRole("button", { name: "Откатить строку" })) {
    expect(button).toHaveProperty("disabled", true);
  }
  await act(async () => resolve(Response.json({ error: "conflict" }, { status: 409 })));
  expect((await screen.findByRole("alert")).textContent).toContain("Изменения обновились");
  expect(screen.getAllByRole("button", { name: "Откатить строку" })[0]).toHaveProperty(
    "disabled",
    true,
  );
  expect(mocks.fetch).toHaveBeenCalledOnce();
  fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
});

it("requires a second click and cancels without changing the draft", () => {
  writeDraft(key, props.after, props.before);
  render(<RevertDiff {...props} />);
  choose();
  expect(mocks.fetch).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(screen.queryByLabelText("Подтверждение отката")).toBeNull();
  expect(readDraft(key)?.text).toBe(props.after);
});

it.each([{ revision: 8 }, { headSha: "updated-head" }])(
  "invalidates an outdated confirmation: %j",
  (update) => {
    const view = render(<RevertDiff {...props} />);
    choose();
    view.rerender(<RevertDiff {...props} {...update} />);
    expect(screen.queryByRole("button", { name: "Подтвердить откат" })).toBeNull();
    expect(screen.getByRole("alert").textContent).toContain("Изменения обновились");
    expect(mocks.fetch).not.toHaveBeenCalled();
  },
);
