import { expect, it } from "vitest";
import { changedDirectories, mergeFileStatuses } from "./file-status";

it("keeps committed additions green after draft edits and decorates ancestors", () => {
  const statuses = mergeFileStatuses({ "docs/new/a.md": "add", "logo.png": "modify" }, [
    { path: "docs/new/a.md", status: "modify" },
    { path: "logo.png", status: "clean" },
    { path: "docs/old.md", status: "delete" },
    { path: "clean.md", status: "clean" },
  ]);
  expect(Object.fromEntries(statuses)).toEqual({
    "docs/new/a.md": "add",
    "logo.png": "modify",
    "docs/old.md": "delete",
  });
  expect([...changedDirectories(statuses)]).toEqual(["docs", "docs/new"]);
});
