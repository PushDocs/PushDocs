import { beforeEach, expect, it, vi } from "vitest";
import { createDiffRevertUndo as issueUndo, readDiffRevertUndo } from "@/lib/diff-revert-undo";

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

const createDiffRevertUndo = (
  scope: Parameters<typeof issueUndo>[0],
  value: Omit<Parameters<typeof issueUndo>[1], "after"> & { after?: string | null },
) =>
  issueUndo(scope, {
    ...value,
    after: value.after === undefined ? "new\nkeep\nchanged" : value.after,
  });
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
  vi.stubEnv("PUSHDOCS_ENCRYPTION_KEY", Buffer.alloc(32, 1).toString("base64"));
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.state.mockResolvedValue({
    branch: { head_commit_sha: "head", repository_paths: ["docs/a.md", "docs/b.md"] },
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
    expectedHeadSha: "head",
    expectedChangeSetId: "set",
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
    undoToken: expect.any(String),
    undoHeadSha: "head",
    undoBlocks: expect.any(Array),
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

const undoScope = { projectId: "project", userId: "user", branch: "fix", path: "docs/a.md" };
function restore(restoreToken: string, overrides: Record<string, unknown> = {}) {
  return POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({
        branch: "fix",
        path: "docs/a.md",
        expectedRevision: 7,
        expectedHeadSha: "head",
        restoreToken,
        ...overrides,
      }),
    }),
    context,
  );
}

it("issues an authenticated snapshot of the saved text and restores after the draft disappears", async () => {
  const result = await (await request("docs/a.md", "https://cms.test", [0, 1])).json();
  expect(readDiffRevertUndo(undoScope, result.undoToken)).toMatchObject({
    changeSetId: "set",
    headSha: "head",
    content: "new\nkeep\nchanged",
  });
  mocks.drafts.mockResolvedValue([]);
  mocks.file.mockResolvedValue({
    baseContentKnown: true,
    content: "old\nkeep\nchanged",
    status: "modify",
  });
  expect((await restore(result.undoToken)).status).toBe(200);
  expect(mocks.stage).toHaveBeenLastCalledWith(
    expect.objectContaining({
      expectedChangeSetId: "set",
      expectedHeadSha: "head",
      expectedRevision: 7,
      files: [{ path: "docs/a.md", content: "new\nkeep\nchanged" }],
    }),
  );
});

it("also issues undo for whole text-file reverts", async () => {
  const result = await (await request()).json();
  expect(readDiffRevertUndo(undoScope, result.undoToken).content).toBe("new\nkeep\nchanged");
  expect(result.undoHeadSha).toBe("head");
});

it("restores one block from a whole-file rollback without restoring its neighbor", async () => {
  const result = await (await request()).json();
  expect(result.undoBlocks).toHaveLength(2);
  mocks.file.mockResolvedValue({ content: "old\nkeep\nlast", status: "clean" });
  expect((await restore(result.undoToken, { restoreBlocks: [1] })).status).toBe(200);
  expect(mocks.stage).toHaveBeenLastCalledWith(
    expect.objectContaining({ files: [{ path: "docs/a.md", content: "old\nkeep\nchanged" }] }),
  );
});

it("keeps a later rollback when an earlier gray block is restored", async () => {
  const result = await (await request("docs/a.md", "https://cms.test", [0, 1])).json();
  mocks.file.mockResolvedValue({ content: "old\nkeep\nlast", status: "clean" });
  expect((await restore(result.undoToken, { restoreBlocks: [0] })).status).toBe(200);
  expect(mocks.stage).toHaveBeenLastCalledWith(
    expect.objectContaining({ files: [{ path: "docs/a.md", content: "new\nkeep\nlast" }] }),
  );
});

it("refuses to overwrite an edit inside a gray block", async () => {
  const result = await (await request()).json();
  mocks.stage.mockClear();
  mocks.file.mockResolvedValue({ content: "external\nkeep\nlast", status: "modify" });
  expect((await restore(result.undoToken, { restoreBlocks: [0] })).status).toBe(409);
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("accepts undo snapshots of large Unicode documents after JSON and encryption expansion", async () => {
  const content = "т".repeat(1_600_000);
  const token = createDiffRevertUndo(undoScope, { changeSetId: "set", headSha: "head", content });
  expect(token.length).toBeGreaterThan(4_000_000);
  expect((await restore(token)).status).toBe(200);
  expect(mocks.stage.mock.calls[0]?.[0].files[0].content === content).toBe(true);
});

it.each([null, "", "new\r\nfile\r\n"])(
  "preserves deleted, empty and new-file states on undo: %j",
  async (content) => {
    const token = createDiffRevertUndo(undoScope, { changeSetId: "set", headSha: "head", content });
    mocks.drafts.mockResolvedValue([]);
    expect((await restore(token)).status).toBe(200);
    expect(mocks.stage).toHaveBeenCalledWith(
      expect.objectContaining({ files: [{ path: "docs/a.md", content }] }),
    );
  },
);

it("captures a deleted file as null, distinct from an empty file", async () => {
  mocks.file.mockResolvedValue({
    baseContentKnown: true,
    baseContent: "old\n",
    content: "",
    status: "delete",
  });
  const result = await (await request("docs/a.md", "https://cms.test", [0])).json();
  expect(readDiffRevertUndo(undoScope, result.undoToken).content).toBeNull();
});

it("rejects tampering and snapshots issued for another user, project, branch or path", async () => {
  for (const scope of [
    { ...undoScope, userId: "other" },
    { ...undoScope, projectId: "other" },
    { ...undoScope, branch: "other" },
    { ...undoScope, path: "docs/b.md" },
  ]) {
    const token = createDiffRevertUndo(scope, {
      changeSetId: "set",
      headSha: "head",
      content: "prior",
    });
    expect((await restore(token)).status).toBe(400);
  }
  const token = createDiffRevertUndo(undoScope, {
    changeSetId: "set",
    headSha: "head",
    content: "prior",
  });
  expect((await restore(`x${token.slice(1)}`)).status).toBe(400);
  expect((await restore(token, { lineIds: [0] })).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("rejects undo after a changed or missing change set, new Git base or external edit", async () => {
  for (const snapshot of [
    { changeSetId: "other", headSha: "head", content: "prior" },
    { changeSetId: "set", headSha: "other", content: "prior" },
  ])
    expect((await restore(createDiffRevertUndo(undoScope, snapshot))).status).toBe(409);
  const token = createDiffRevertUndo(undoScope, {
    changeSetId: "set",
    headSha: "head",
    content: "prior",
  });
  expect((await restore(token, { expectedRevision: 6 })).status).toBe(409);
  mocks.state.mockResolvedValue({ branch: { head_commit_sha: "head" } });
  expect((await restore(token)).status).toBe(409);
  expect(mocks.stage).not.toHaveBeenCalled();
});

it("still checks write access, uploads and configuration on undo", async () => {
  const token = createDiffRevertUndo(undoScope, {
    changeSetId: "set",
    headSha: "head",
    content: "prior",
  });
  mocks.access.mockRejectedValueOnce(
    Object.assign(new Error("Forbidden"), { code: "ACCESS_DENIED" }),
  );
  expect((await restore(token)).status).toBe(403);
  mocks.uploads.mockResolvedValue([{ repository_path: "docs/a.md", change_set_id: "set" }]);
  expect((await restore(token)).status).toBe(400);
  const configToken = createDiffRevertUndo(
    { ...undoScope, path: ".pushdocs/config.json" },
    { changeSetId: "set", headSha: "head", content: "invalid" },
  );
  expect((await restore(configToken, { path: ".pushdocs/config.json" })).status).toBe(400);
  mocks.access.mockResolvedValue({ role: "admin" });
  expect((await restore(configToken, { path: ".pushdocs/config.json" })).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
});
