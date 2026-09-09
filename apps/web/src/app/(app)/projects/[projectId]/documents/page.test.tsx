import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  branches: vi.fn(),
  imported: vi.fn(),
  context: vi.fn(),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (user: unknown) => user,
  application: () => ({
    listProjects: async () => [{ id: "project", defaultBranch: "stable", name: "Docs" }],
  }),
  repository: () => ({
    listBranches: mocks.branches,
    hasImportedBranch: mocks.imported,
    listProjectComponents: async () => [],
    listAttachments: async () => [
      { change_set_id: "draft", repository_path: "static/img/new.png" },
      { change_set_id: "other", repository_path: "other.png" },
    ],
  }),
}));
vi.mock("@/lib/workbench", () => ({ workbenchContext: mocks.context }));
vi.mock("@/components/workbench", () => ({ Workbench: () => null }));
vi.mock("@/components/branch-import", () => ({ BranchImport: () => null }));

import { BranchImport } from "@/components/branch-import";
import { Workbench } from "@/components/workbench";
import DocumentsPage from "./page";

const page = () =>
  DocumentsPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "docs/fix" }),
  });
beforeEach(() => {
  mocks.branches.mockResolvedValue([{ full_ref: "docs/fix" }]);
  mocks.context.mockResolvedValue({
    state: { files: [], branch: { id: "branch", repository_paths: [], head_commit_sha: "sha" } },
    access: { role: "editor" },
    config: {},
  });
  mocks.imported.mockResolvedValue(false);
});
it("starts loading a branch absent from the local catalog", async () => {
  mocks.branches.mockResolvedValue([]);
  const view = await page();
  expect(view.type).toBe(BranchImport);
  expect(view.props.branch).toBe("docs/fix");
  expect(mocks.context).not.toHaveBeenCalled();
});
it("loads a catalog-only branch instead of opening an empty editor", async () => {
  expect((await page()).type).toBe(BranchImport);
  expect(mocks.context).toHaveBeenCalledWith("project", "docs/fix");
});
it("opens a successfully imported empty repository", async () => {
  mocks.imported.mockResolvedValue(true);
  expect((await page()).type).toBe(Workbench);
});
it("opens existing branch drafts without importing over them", async () => {
  const context = await mocks.context();
  context.state.files = [{ path: "docs/new.md", content: "Draft", status: "add" }];
  mocks.context.mockResolvedValue(context);
  expect((await page()).type).toBe(Workbench);
  expect(mocks.imported).not.toHaveBeenCalled();
});

it("opens the attachment panel with only uploads belonging to this draft", async () => {
  const current = await mocks.context();
  current.state.branch.repository_paths = ["docs/a.md"];
  current.state.changeSet = { id: "draft", revision: 2, status: "open" };
  const view = await DocumentsPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "docs/fix", path: "docs/a.md", panel: "files" }),
  });
  expect(view.props.initialPanel).toBe("media");
  expect(view.props.initialPath).toBe("docs/a.md");
  expect(view.props.initial.uploads).toEqual([{ path: "static/img/new.png" }]);
});
