import { RevisionConflictError } from "@pushdocs/db";
import { AccessDeniedError } from "@pushdocs/domain";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  access: vi.fn(),
  config: vi.fn(),
  exchange: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  requireUser: mocks.user,
  repository: () => ({
    requireProjectAccess: mocks.access,
    getWorkingFile: mocks.config,
    exchangeDocument: mocks.exchange,
  }),
}));

import { POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
const request = (input: unknown, origin = "https://docs.test") =>
  new Request("https://docs.test/api/projects/project/collaboration", {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
beforeEach(() => {
  vi.clearAllMocks();
  mocks.user.mockResolvedValue({ id: "user" });
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.config.mockResolvedValue(undefined);
  mocks.exchange.mockResolvedValue({
    epoch: "epoch",
    update: "AAA=",
    vector: "AA==",
    content: "# Intro",
    revision: 4,
  });
});
it("exchanges only the authorized document operations without accessing Git", async () => {
  const response = await POST(request({ branch: "main", path: "docs/intro.md" }), context);
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  expect(mocks.exchange).toHaveBeenCalledWith({
    projectId: "project",
    userId: "user",
    branch: "main",
    path: "docs/intro.md",
  });
});
it("rejects cross-origin writes and malformed document paths before exchanging operations", async () => {
  expect(
    (await POST(request({ branch: "main", path: "docs/a.md" }, "https://evil.test"), context))
      .status,
  ).toBe(400);
  expect((await POST(request({ branch: "main", path: "../a.md" }), context)).status).toBe(400);
  expect(
    (await POST(request({ branch: "main", path: ".pushdocs/config.json" }), context)).status,
  ).toBe(400);
  expect(
    (
      await POST(
        request({ branch: "main", path: "docs/a.md", update: "x".repeat(8_200_000) }),
        context,
      )
    ).status,
  ).toBe(400);
  expect(mocks.exchange).not.toHaveBeenCalled();
});
it("reports revoked access and external document conflicts distinctly", async () => {
  mocks.exchange.mockRejectedValueOnce(new AccessDeniedError("document:write"));
  expect((await POST(request({ branch: "main", path: "docs/a.md" }), context)).status).toBe(403);
  mocks.exchange.mockRejectedValueOnce(new RevisionConflictError("Документ перемещён"));
  const response = await POST(request({ branch: "main", path: "docs/a.md" }), context);
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "Документ перемещён" });
});
