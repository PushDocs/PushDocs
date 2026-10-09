import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  list: vi.fn(),
  remove: vi.fn(),
  stop: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    listProjectPreviews: mocks.list,
    requestPreviewDeletion: mocks.remove,
    stopPreview: mocks.stop,
  }),
}));

import { DELETE, GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.access.mockResolvedValue({ role: "reader" });
  mocks.list.mockResolvedValue([{ branch: "main", port: 43000, status: "queued" }]);
});
function request(origin = "https://cms.test") {
  return DELETE(
    new Request("https://cms.test/api", {
      method: "DELETE",
      headers: { Origin: origin },
      body: JSON.stringify({ branch: "main" }),
    }),
    context,
  );
}
it("makes queued previews and URLs available to readers without caching", async () => {
  const response = await GET(new Request("https://cms.test/api"), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(await response.json()).toMatchObject({
    previews: [{ status: "queued", url: expect.stringContaining(":43000/") }],
  });
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
});
it("requires administrator permission before queuing deletion", async () => {
  mocks.access.mockRejectedValueOnce(
    Object.assign(new Error("Forbidden"), { code: "ACCESS_DENIED" }),
  );
  expect((await request()).status).toBe(403);
  expect(mocks.remove).not.toHaveBeenCalled();
  mocks.access.mockResolvedValue({ role: "admin" });
  expect((await request()).status).toBe(202);
  expect(mocks.access).toHaveBeenLastCalledWith("user", "project", "member:manage");
  expect(mocks.remove).toHaveBeenCalledWith("project", "main");
});
it("rejects cross-origin deletion before touching the repository", async () => {
  expect((await request("https://evil.test")).status).toBe(400);
  expect(mocks.remove).not.toHaveBeenCalled();
});

it("lets project users stop a running preview without requesting workspace deletion", async () => {
  const response = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({ branch: "main", action: "stop" }),
    }),
    context,
  );
  expect(response.status).toBe(202);
  expect(mocks.access).toHaveBeenLastCalledWith("user", "project", "project:read");
  expect(mocks.stop).toHaveBeenCalledWith("project", "main");
  expect(mocks.remove).not.toHaveBeenCalled();
});
