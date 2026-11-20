import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  state: vi.fn(),
  drafts: vi.fn(),
  uploads: vi.fn(),
  stage: vi.fn(),
  file: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    getBranchState: mocks.state,
    listDraftFiles: mocks.drafts,
    listAttachments: mocks.uploads,
    stageFiles: mocks.stage,
    getWorkingFile: mocks.file,
  }),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
function request(path = "docs/a.md", origin = "https://cms.test", lineIds?: number[]) {
  return POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({
        branch: "fix",
        path,
        expectedRevision: 7,
        expectedHeadSha: lineIds ? "head" : undefined,
        lineIds,
      }),
    }),
    context,
  );
}
beforeEach(() => {
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.state.mockResolvedValue({
    branch: { head_commit_sha: "head" },
    changeSet: { id: "set", revision: 7, status: "open" },
  });
  mocks.drafts.mockResolvedValue([
    { path: "docs/a.md", change_set_id: "set" },
    { path: "docs/b.md", change_set_id: "set" },
  ]);
  mocks.uploads.mockResolvedValue([]);
  mocks.stage.mockResolvedValue(undefined);
  mocks.file.mockResolvedValue({
    baseContentKnown: true,
    baseContent: "old\nkeep\nlast",
    content: "new\nkeep\nchanged",
  });
});
it("reverts exactly one file using the displayed revision and source branch", async () => {
  expect((await request()).status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith("user", "project", "document:write");
  expect(mocks.stage).toHaveBeenCalledWith({
    projectId: "project",
    branch: "fix",
    userId: "user",
    expectedRevision: 7,
    files: [{ path: "docs/a.md", revert: true }],
  });
});
it("supports binary uploads outside the document and media roots", async () => {
  mocks.uploads.mockResolvedValue([{ repository_path: "assets/image.png", change_set_id: "set" }]);
  expect((await request("assets/image.png")).status).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.objectContaining({ files: [{ path: "assets/image.png", revert: true }] }),
  );
});
it("does not revert uploads or drafts from another change set", async () => {
  mocks.uploads.mockResolvedValue([{ repository_path: "other.png", change_set_id: "other" }]);
  mocks.drafts.mockResolvedValue([{ path: "other.png", change_set_id: "other" }]);
  expect((await request("other.png")).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});
it("rejects cross-origin requests and unsafe paths", async () => {
  expect((await request("docs/a.md", "https://evil.test")).status).toBe(400);
  expect((await request("../docs/a.md")).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});
it("requires write access and restricts configuration rollback to admins", async () => {
  mocks.access.mockRejectedValueOnce(
    Object.assign(new Error("Forbidden"), { code: "ACCESS_DENIED" }),
  );
  expect((await request()).status).toBe(403);
  mocks.drafts.mockResolvedValue([{ path: ".pushdocs/config.json", change_set_id: "set" }]);
  expect((await request(".pushdocs/config.json")).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue({ role: "admin" });
  expect((await request(".pushdocs/config.json")).status).toBe(200);
});
it("returns a revision conflict without retrying an outdated or locked change set", async () => {
  mocks.stage.mockRejectedValueOnce(
    Object.assign(new Error("Обновите страницу"), { code: "REVISION_CONFLICT" }),
  );
  expect((await request()).status).toBe(409);
  expect(mocks.stage).toHaveBeenCalledTimes(1);
});
it("does not create a change set when there is nothing to revert", async () => {
  mocks.state.mockResolvedValue({ changeSet: undefined });
  expect((await request()).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("computes a partial rollback from saved content and returns the new revision", async () => {
  mocks.stage.mockResolvedValue({ revision: 8 });
  const response = await request("docs/a.md", "https://cms.test", [0, 1]);
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({
    reverted: false,
    content: "old\nkeep\nchanged",
    revision: 8,
  });
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.objectContaining({
      expectedRevision: 7,
      expectedHeadSha: "head",
      files: [{ path: "docs/a.md", content: "old\nkeep\nchanged" }],
    }),
  );
});

it.each([
  ["", "new\n", [0]],
  ["removed\n", "", [0]],
  ["old\n", "new\n", [0, 1]],
])("removes the draft when its last change is reverted", async (baseContent, content, lineIds) => {
  mocks.file.mockResolvedValue({ baseContentKnown: true, baseContent, content });
  expect((await request("docs/a.md", "https://cms.test", lineIds)).status).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.objectContaining({ files: [{ path: "docs/a.md", revert: true }] }),
  );
});

it.each([6, 8])(
  "rejects stale displayed revision %s before computing line IDs",
  async (revision) => {
    mocks.state.mockResolvedValue({ changeSet: { id: "set", revision, status: "open" } });
    expect((await request("docs/a.md", "https://cms.test", [0, 1])).status).toBe(409);
    expect(mocks.file).not.toHaveBeenCalled();
    expect(mocks.stage).not.toHaveBeenCalled();
  },
);

it("rejects partial rollback for uploads, missing files and invalid line IDs", async () => {
  mocks.uploads.mockResolvedValueOnce([{ repository_path: "docs/a.md", change_set_id: "set" }]);
  expect((await request("docs/a.md", "https://cms.test", [0])).status).toBe(400);
  mocks.file.mockResolvedValueOnce(undefined);
  expect((await request("docs/a.md", "https://cms.test", [0])).status).toBe(400);
  for (const ids of [[], [2], [0, 0], [99], [-1]]) {
    expect((await request("docs/a.md", "https://cms.test", ids)).status).toBe(400);
  }
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("does not save a partial rollback that breaks project configuration", async () => {
  mocks.access.mockResolvedValue({ role: "admin" });
  mocks.drafts.mockResolvedValue([{ path: ".pushdocs/config.json", change_set_id: "set" }]);
  mocks.file.mockResolvedValue({
    baseContentKnown: true,
    baseContent: '{\n"version": 1\n}',
    content: '{\n"version": 1,\n"defaultLocale": "ru"\n}',
  });
  expect((await request(".pushdocs/config.json", "https://cms.test", [3])).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("blocks changed Git bases and unknown original content", async () => {
  mocks.state.mockResolvedValueOnce({
    branch: { head_commit_sha: "new-head" },
    changeSet: { id: "set", revision: 7, status: "open" },
  });
  expect((await request("docs/a.md", "https://cms.test", [0, 1])).status).toBe(409);
  mocks.file.mockResolvedValueOnce({
    baseContentKnown: false,
    baseContent: "",
    content: "unimported Git file",
  });
  expect((await request("docs/a.md", "https://cms.test", [0])).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});
