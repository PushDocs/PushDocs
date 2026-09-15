import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
  markRead: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: mocks.user,
  repository: () => ({
    requireProjectAccess: mocks.access,
    listCommentReadState: mocks.list,
    markCommentsRead: mocks.markRead,
    createComment: mocks.create,
  }),
}));

import { GET, PATCH, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.access.mockResolvedValue({ role: "reader" });
  mocks.list.mockResolvedValue([{ body: "Comment" }]);
});
it("scopes comments to the project, branch and file", async () => {
  const response = await GET(
    new Request("https://cms.test/api?branch=docs%2Fnew&path=docs%2Fa.md"),
    context,
  );
  expect(await response.json()).toEqual([{ body: "Comment" }]);
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
  expect(mocks.list).toHaveBeenCalledWith("user", "project", "docs/new", "docs/a.md");
});
it("lets an authorised reader comment without permission to edit documents", async () => {
  const response = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({ branch: "main", path: "docs/a.md", body: " Comment " }),
    }),
    context,
  );
  expect(response.status).toBe(200);
  expect(mocks.access).toHaveBeenCalledWith("user", "project", "comment:create");
  expect(mocks.create).toHaveBeenCalledWith({
    projectId: "project",
    userId: "user",
    branch: "main",
    documentPath: "docs/a.md",
    body: "Comment",
    anchorQuote: null,
  });
});
it("rejects missing membership and cross-origin requests", async () => {
  mocks.access.mockRejectedValueOnce({ code: "ACCESS_DENIED" });
  expect((await GET(new Request("https://cms.test/api"), context)).status).toBe(403);
  expect(
    (await POST(new Request("https://cms.test/api", { method: "POST", body: "{}" }), context))
      .status,
  ).toBe(400);
  expect(mocks.create).not.toHaveBeenCalled();
});

it("does not broaden missing branch and file filters", async () => {
  expect((await GET(new Request("https://cms.test/api"), context)).status).toBe(200);
  expect(mocks.list).toHaveBeenCalledWith("user", "project", "", "");
});

it("marks exactly the displayed comments for the authenticated user, including readers", async () => {
  const commentIds = ["00000000-0000-4000-8000-000000000001"];
  mocks.markRead.mockResolvedValue(commentIds);
  const response = await PATCH(
    new Request("https://cms.test/api", {
      method: "PATCH",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({ branch: "main", path: "docs/a.md", commentIds, userId: "other" }),
    }),
    context,
  );
  expect(await response.json()).toEqual({ readIds: commentIds });
  expect(mocks.markRead).toHaveBeenCalledWith({
    userId: "user",
    projectId: "project",
    branch: "main",
    documentPath: "docs/a.md",
    commentIds,
  });
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
});

it("rejects cross-origin and invalid read receipts before writing them", async () => {
  for (const [origin, input] of [
    ["https://evil.test", { branch: "main", path: "a", commentIds: [] }],
    ["https://cms.test", { branch: "main", path: "a", commentIds: ["not-a-uuid"] }],
  ] as const) {
    const response = await PATCH(
      new Request("https://cms.test/api", {
        method: "PATCH",
        headers: { Origin: origin },
        body: JSON.stringify(input),
      }),
      context,
    );
    expect(response.status).toBe(400);
  }
  expect(mocks.markRead).not.toHaveBeenCalled();
});
