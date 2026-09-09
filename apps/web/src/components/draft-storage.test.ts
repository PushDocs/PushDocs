// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { clearDraft, draftKey, readDraft, writeDraft } from "./draft-storage";

beforeEach(() => localStorage.clear());
afterEach(() => vi.restoreAllMocks());
it("keeps drafts isolated by account, project, branch and path", () => {
  const key = draftKey("p", "fix", "docs/a.md", "alice");
  expect(writeDraft(key, "unsaved\r\n", "base\r\n")).toBe(true);
  expect(readDraft(key)).toEqual({ text: "unsaved\r\n", base: "base\r\n" });
  for (const other of [
    draftKey("p", "main", "docs/a.md", "alice"),
    draftKey("p", "fix", "docs/b.md", "alice"),
    draftKey("p2", "fix", "docs/a.md", "alice"),
    draftKey("p", "fix", "docs/a.md", "bob"),
  ])
    expect(readDraft(other)).toBeUndefined();
  clearDraft(key);
  expect(readDraft(key)).toBeUndefined();
});
it("ignores damaged storage and reports unavailable backups without throwing", () => {
  localStorage.setItem("draft", "not json");
  expect(readDraft("draft")).toBeUndefined();
  localStorage.setItem("draft", '{"text": 12, "base": ""}');
  expect(readDraft("draft")).toBeUndefined();
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("quota");
  });
  expect(writeDraft("draft", "text", "base")).toBe(false);
});
