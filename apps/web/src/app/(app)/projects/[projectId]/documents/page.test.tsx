import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  branches: vi.fn(),
  imported: vi.fn(),
  context: vi.fn(),
  workingFile: vi.fn(),
  attachments: vi.fn(),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (user: unknown) => user,
  repository: () => ({
    getProjectForUser: async () => ({
      id: "project",
      defaultBranch: "stable",
      name: "Docs",
      role: "editor",
    }),
    listBranches: mocks.branches,
    hasImportedBranch: mocks.imported,
    listProjectComponents: async () => [],
    listAttachmentsForChangeSet: mocks.attachments,
    getWorkingFile: mocks.workingFile,
  }),
}));
vi.mock("@/lib/workbench", () => ({ localWorkbenchIndexContext: mocks.context }));
vi.mock("@/components/workbench", () => ({ Workbench: () => null }));
vi.mock("@/components/branch-import", () => ({ BranchImport: () => null }));

import { BranchImport } from "@/components/branch-import";
import { LivePreviewButton } from "@/components/live-preview-button";
import { Workbench } from "@/components/workbench";
import DocumentsPage from "./page";

const page = () =>
  DocumentsPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "docs/fix" }),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.branches.mockResolvedValue([{ full_ref: "docs/fix" }]);
  mocks.context.mockResolvedValue({
    state: { files: [], branch: { id: "branch", repository_paths: [], head_commit_sha: "sha" } },
    access: { role: "editor" },
    config: {},
  });
  mocks.workingFile.mockResolvedValue(undefined);
  mocks.attachments.mockResolvedValue([
    { change_set_id: "draft", repository_path: "static/img/new.png" },
  ]);
  mocks.imported.mockResolvedValue(false);
});
it("starts loading a branch absent from the local catalog", async () => {
  mocks.branches.mockResolvedValue([]);
  const view = await page();
  expect(view.type).toBe(BranchImport);
  expect(view.props.branch).toBe("docs/fix");
  expect(mocks.context).toHaveBeenCalledWith("project", "docs/fix", { id: "user" });
});
it("loads a catalog-only branch instead of opening an empty editor", async () => {
  expect((await page()).type).toBe(BranchImport);
  expect(mocks.context).toHaveBeenCalledWith("project", "docs/fix", { id: "user" });
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

it("starts the selected branch preview from the documents header", async () => {
  mocks.imported.mockResolvedValue(true);
  const view = await page();
  expect(view.type).toBe(Workbench);
  expect(view.props.headerAction.type).toBe(LivePreviewButton);
  expect(view.props.headerAction.props).toEqual({ projectId: "project", branch: "docs/fix" });
});

it("renders the file tree from metadata and loads only the initially selected body", async () => {
  const context = await mocks.context();
  context.state.files = [
    {
      path: "docs/a.md",
      content: "",
      baseContent: "",
      loaded: false,
      status: "clean",
      title: "A",
    },
    {
      path: "docs/b.md",
      content: "",
      baseContent: "",
      loaded: false,
      status: "clean",
      title: "B",
    },
  ];
  mocks.context.mockResolvedValue(context);
  mocks.workingFile.mockResolvedValue({
    ...context.state.files[0],
    content: "# A",
    baseContent: "# A",
    loaded: true,
  });
  const view = await page();
  expect(view.type).toBe(Workbench);
  expect(mocks.workingFile).toHaveBeenCalledOnce();
  expect(mocks.workingFile).toHaveBeenCalledWith("project", "docs/fix", "docs/a.md");
  expect(view.props.initial.files).toEqual([
    expect.objectContaining({ path: "docs/a.md", content: "# A", loaded: true }),
    expect.objectContaining({ path: "docs/b.md", content: "", loaded: false }),
  ]);
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
  expect(mocks.attachments).toHaveBeenCalledWith("project", "draft");
});
