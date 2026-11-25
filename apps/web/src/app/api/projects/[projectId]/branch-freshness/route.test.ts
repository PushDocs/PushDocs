import { AccessDeniedError } from "@pushdocs/domain";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  target: vi.fn(),
  provider: vi.fn(),
  branches: vi.fn(),
  ancestor: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    getProjectSyncTarget: mocks.target,
  }),
}));
vi.mock("@/lib/provider", () => ({ providerForConnection: mocks.provider }));

import { GET } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
const request = (branch = "docs/task") =>
  GET(new Request(`https://cms.test/api?${new URLSearchParams({ branch })}`), context);

beforeEach(() => {
  mocks.access.mockResolvedValue({ role: "reader" });
  mocks.target.mockResolvedValue({
    provider_repository_id: "42",
    secret_encrypted: "secret",
    default_branch: "stable",
  });
  mocks.provider.mockResolvedValue({ listBranches: mocks.branches, isAncestor: mocks.ancestor });
  mocks.ancestor.mockResolvedValue(true);
  mocks.branches.mockResolvedValue([
    { name: "docs/task", sha: "live-head" },
    { name: "stable", sha: "base-head" },
  ]);
});

it("reads the live SHA for readers without returning credentials or caching it", async () => {
  const response = await request();
  expect(await response.json()).toEqual({
    remoteSha: "live-head",
    defaultBranch: "stable",
    defaultHeadSha: "base-head",
    includesDefaultBranch: true,
  });
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.access).toHaveBeenCalledWith("user", "project", "project:read");
  expect(mocks.branches).toHaveBeenCalledWith("42");
  expect(mocks.ancestor).toHaveBeenCalledWith("42", "base-head", "live-head");
});

it("reports unknown freshness for a deleted branch", async () => {
  expect(await (await request("deleted")).json()).toMatchObject({
    remoteSha: null,
    includesDefaultBranch: null,
  });
  expect(mocks.ancestor).not.toHaveBeenCalled();
});

it("recognizes the default branch without an ancestry request", async () => {
  expect(await (await request("stable")).json()).toMatchObject({
    remoteSha: "base-head",
    includesDefaultBranch: true,
  });
  expect(mocks.ancestor).not.toHaveBeenCalled();
});

it("identifies updates needed from stable independently of review readiness", async () => {
  mocks.ancestor.mockResolvedValue(false);
  expect(await (await request()).json()).toMatchObject({
    remoteSha: "live-head",
    includesDefaultBranch: false,
  });
});

it("preserves the live SHA when ancestry cannot be determined", async () => {
  mocks.ancestor.mockRejectedValue(new Error("comparison unavailable"));
  expect(await (await request()).json()).toMatchObject({
    remoteSha: "live-head",
    includesDefaultBranch: null,
  });
  mocks.branches.mockResolvedValue([{ name: "docs/task", sha: "live-head" }]);
  expect(await (await request()).json()).toMatchObject({
    remoteSha: "live-head",
    defaultHeadSha: null,
    includesDefaultBranch: null,
  });
});

it("checks access before contacting Git", async () => {
  mocks.access.mockRejectedValue(new AccessDeniedError("project:read"));
  expect((await request()).status).toBe(403);
  expect(mocks.target).not.toHaveBeenCalled();
  expect(mocks.provider).not.toHaveBeenCalled();
});

it("handles a missing branch, unavailable connection and Git failure", async () => {
  expect((await request("")).status).toBe(400);
  mocks.target.mockResolvedValueOnce(null);
  expect((await request()).status).toBe(400);
  mocks.branches.mockRejectedValue(new Error("offline"));
  expect((await request()).status).toBe(400);
});
