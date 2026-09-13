// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  documentHref,
  ProjectContext,
  readProjectBranch,
  rememberProjectBranch,
} from "./project-context";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

it("remembers project context and restores the selected document", () => {
  const refresh = vi.fn();
  window.addEventListener("pushdocs:context", refresh, { once: true });
  render(<ProjectContext projectId="project" branch="docs/update" />);
  expect(readProjectBranch("project", "main")).toBe("docs/update");
  expect(refresh).toHaveBeenCalledOnce();
  sessionStorage.setItem(
    "pushdocs:tabs:project:docs/update",
    JSON.stringify({ selected: "docs/a.md" }),
  );
  expect(documentHref("project", "docs/update")).toContain("path=docs%2Fa.md");
});

it("falls back when optional session storage is unavailable or malformed", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  expect(readProjectBranch("project", "main")).toBe("main");
  expect(documentHref("project", "main")).toBe("/projects/project/documents?branch=main");
  vi.restoreAllMocks();
  sessionStorage.setItem("pushdocs:tabs:project:main", "not json");
  expect(documentHref("project", "main")).toBe("/projects/project/documents?branch=main");
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("disabled");
  });
  expect(() => rememberProjectBranch("project", "main")).not.toThrow();
});
