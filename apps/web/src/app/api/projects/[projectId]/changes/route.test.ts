import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  state: vi.fn(),
  drafts: vi.fn(),
  uploads: vi.fn(),
  stage: vi.fn(),
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
  }),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
function request(path = "docs/a.md", origin = "https://cms.test") {
  return POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ branch: "fix", path, expectedRevision: 7 }),
    }),
    context,
  );
}
beforeEach(() => {
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.state.mockResolvedValue({ changeSet: { id: "set", revision: 7, status: "open" } });
  mocks.drafts.mockResolvedValue([
    { path: "docs/a.md", change_set_id: "set" },
    { path: "docs/b.md", change_set_id: "set" },
  ]);
  mocks.uploads.mockResolvedValue([]);
  mocks.stage.mockResolvedValue(undefined);
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
