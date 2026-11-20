import { expect, it } from "vitest";
import { parseLineNumber, projectChangesHref, projectDocumentLineHref } from "./project-paths";

it("uses the changes route for revalidation without a query", () => {
  expect(projectChangesHref("project")).toBe("/projects/project/changes");
});

it("keeps branch links compatible and encodes branch and conflict parameters", () => {
  expect(projectChangesHref("project", "docs/a & b")).toBe(
    "/projects/project/changes?branch=docs%2Fa+%26+b",
  );
  expect(projectChangesHref("project", { branch: "docs/a & b", conflict: "review/id" })).toBe(
    "/projects/project/changes?branch=docs%2Fa+%26+b&conflict=review%2Fid",
  );
});

it("omits an unspecified branch when opening a background conflict inspection", () => {
  expect(projectChangesHref("project", { branch: undefined, resolve: "review" })).toBe(
    "/projects/project/changes?resolve=review",
  );
});

it("links to an editor line and restores the same changes context", () => {
  expect(projectDocumentLineHref("p", "docs/fix", "docs/a.md", 25, "a b")).toBe(
    "/projects/p/documents?branch=docs%2Ffix&path=docs%2Fa.md&line=25&from=changes&search=a+b",
  );
  expect(
    projectChangesHref("p", { branch: "docs/fix", path: "docs/a.md", line: "25", search: "a b" }),
  ).toBe("/projects/p/changes?branch=docs%2Ffix&path=docs%2Fa.md&line=25&search=a+b");
  expect(parseLineNumber("25")).toBe(25);
  for (const value of [undefined, "", "-1", "0", "2.5", "Infinity", "wrong"])
    expect(parseLineNumber(value)).toBeUndefined();
});
