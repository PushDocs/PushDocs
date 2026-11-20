import { expect, it } from "vitest";
import { projectChangesHref } from "./project-paths";

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
