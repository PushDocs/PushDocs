import { parseProjectConfig } from "@pushdocs/content";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  access: vi.fn(),
  stage: vi.fn(),
  attachments: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workbench", async (original) => ({
  ...(await original<typeof import("@/lib/workbench")>()),
  workbenchContext: mocks.context,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  mocks.access.mockResolvedValue({ role: "editor" });
  mocks.attachments.mockResolvedValue([]);
  mocks.context.mockResolvedValue({
    config: parseProjectConfig(),
    user: { id: "user" },
    access: { role: "editor" },
    state: {
      branch: { repository_paths: ["static/img/a.png"] },
      files: [],
      changeSet: { id: "change", revision: 2, status: "open" },
    },
    store: {
      requireProjectAccess: mocks.access,
      listAttachments: mocks.attachments,
      stageFiles: mocks.stage,
    },
  });
});
it("lists Git files and stages an authorized deletion with revision protection", async () => {
  const response = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(await response.json()).toMatchObject({
    revision: 2,
    assets: [{ path: "static/img/a.png", status: "clean" }],
  });
  const deleted = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({
        branch: "main",
        path: "static/img/a.png",
        action: "delete",
        revision: 2,
      }),
    }),
    context,
  );
  expect(deleted.status).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith({
    projectId: "project",
    branch: "main",
    userId: "user",
    expectedRevision: 2,
    files: [{ path: "static/img/a.png", content: null }],
  });
});

it("includes only this branch's uploads and supports reverting a deletion", async () => {
  mocks.attachments.mockResolvedValue([
    { change_set_id: "other", repository_path: "static/img/private.png", size_bytes: 5 },
    { change_set_id: "change", repository_path: "static/img/new.png", size_bytes: "20" },
  ]);
  const response = await GET(
    new Request("https://cms.test/api?branch=main&locale=en&document=docs/a.md"),
    context,
  );
  expect((await response.json()).assets).toEqual([
    expect.objectContaining({ path: "static/img/a.png" }),
    expect.objectContaining({ path: "static/img/new.png", size: 20 }),
  ]);
  const result = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({
        branch: "main",
        path: "static/img/a.png",
        action: "revert",
        revision: 2,
        locale: "en",
        document: "docs/a.md",
      }),
    }),
    context,
  );
  expect(result.status).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.objectContaining({ files: [{ path: "static/img/a.png", revert: true }] }),
  );
});

it("rejects forbidden roles, CSRF, paths outside media and stale revisions", async () => {
  const request = (path = "static/img/a.png", origin = "https://cms.test") =>
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: origin },
      body: JSON.stringify({ branch: "main", path, action: "delete", revision: 2 }),
    });
  expect((await POST(request("static/img/a.png", "https://evil.test"), context)).status).toBe(400);
  expect((await POST(request("docs/a.md"), context)).status).toBe(400);
  expect((await POST(request("other/a.png"), context)).status).toBe(400);
  expect((await POST(request("../secret.png"), context)).status).toBe(400);
  mocks.access.mockRejectedValueOnce(Object.assign(new Error("Reader"), { code: "ACCESS_DENIED" }));
  expect((await POST(request(), context)).status).toBe(403);
  mocks.stage.mockRejectedValueOnce(
    Object.assign(new Error("Changed"), { code: "REVISION_CONFLICT" }),
  );
  expect((await POST(request(), context)).status).toBe(409);
  mocks.context.mockRejectedValueOnce(new Error("Missing project"));
  expect((await GET(new Request("https://cms.test/api"), context)).status).toBe(400);
});

it("reports an empty branch without an active change set", async () => {
  const value = await mocks.context();
  delete value.state.changeSet;
  mocks.context.mockResolvedValue(value);
  expect(await (await GET(new Request("https://cms.test/api"), context)).json()).toMatchObject({
    status: "open",
    revision: 0,
  });
});

it("uses the open article locale when no locale is explicitly chosen", async () => {
  const current = await mocks.context();
  current.state.files = [
    { path: "i18n/en/docs/a.md", locale: "en", content: "# A", status: "clean" },
  ];
  const response = await GET(
    new Request("https://cms.test/api?branch=main&document=i18n%2Fen%2Fdocs%2Fa.md"),
    context,
  );
  expect((await response.json()).locale).toBe("en");
});
