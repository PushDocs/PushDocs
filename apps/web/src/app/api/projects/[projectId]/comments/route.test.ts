import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  list: vi.fn(),
  create: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: mocks.user,
  repository: () => ({
    requireProjectAccess: mocks.access,
    listComments: mocks.list,
    createComment: mocks.create,
  }),
}));

import { GET, POST } from "./route";

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
  expect(mocks.list).toHaveBeenCalledWith("project", "docs/new", "docs/a.md");
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
  expect(mocks.list).toHaveBeenCalledWith("project", "", "");
});
