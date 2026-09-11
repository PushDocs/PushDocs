// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ProjectResumeLink } from "./project-resume-link";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
it("continues the working branch and selected file from the projects list", () => {
  sessionStorage.setItem("pushdocs:branch:p", "docs/my work");
  sessionStorage.setItem("pushdocs:tabs:p:docs/my work", JSON.stringify({ selected: "docs/a.md" }));
  render(
    <ProjectResumeLink projectId="p" defaultBranch="stable">
      Docs
    </ProjectResumeLink>,
  );
  const href = new URL(screen.getByRole("link").getAttribute("href") ?? "", "https://test.local");
  expect(href.searchParams.get("branch")).toBe("docs/my work");
  expect(href.searchParams.get("path")).toBe("docs/a.md");
});
it("uses the main branch on first open", () => {
  render(
    <ProjectResumeLink projectId="p" defaultBranch="stable">
      Docs
    </ProjectResumeLink>,
  );
  expect(screen.getByRole("link").getAttribute("href")).toBe("/projects/p/documents?branch=stable");
});
