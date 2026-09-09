import { expect, it, vi } from "vitest";

const redirect = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect }));

import FilesPage from "./page";

it("opens attachments in the editor with the original branch and article", async () => {
  await FilesPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "docs/fix", document: "docs/a.mdx" }),
  });
  expect(redirect).toHaveBeenCalledWith(
    "/projects/project/documents?panel=files&branch=docs%2Ffix&path=docs%2Fa.mdx",
  );
});
it("lets Documents choose the current article instead of inventing a file path", async () => {
  await FilesPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({}),
  });
  expect(redirect).toHaveBeenCalledWith("/projects/project/documents?panel=files");
});
