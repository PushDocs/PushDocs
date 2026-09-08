import { parseProjectConfig } from "@pushdocs/content";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  access: vi.fn(),
  values: vi.fn(),
  revision: 3,
  status: "open",
  noChange: false,
  existing: false,
  active: [] as Array<{ id: string }>,
  builds: [] as Array<Record<string, unknown>>,
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workbench", async (original) => ({
  ...(await original<typeof import("@/lib/workbench")>()),
  workbenchContext: mocks.context,
}));
vi.mock("@pushdocs/db", async (original) => {
  const database = {
    selectFrom: (table: string) => query(table),
    insertInto: (table: string) => query(table),
    transaction: () => ({ execute: (fn: (db: unknown) => unknown) => fn(database) }),
  };
  function query(table: string) {
    let activeQuery = false;
    const builder = {
      select: (column: unknown) => {
        activeQuery = column === "id";
        return builder;
      },
      selectAll: () => builder,
      where: () => builder,
      forUpdate: () => builder,
      forNoKeyUpdate: () => builder,
      orderBy: () => builder,
      limit: () => builder,
      values: (value: unknown) => {
        mocks.values(value);
        return builder;
      },
      returning: () => builder,
      executeTakeFirstOrThrow: async () =>
        table === "branch_contexts" ? { id: "branch", head_commit_sha: "sha" } : { id: "build" },
      executeTakeFirst: async () =>
        table === "change_sets"
          ? mocks.noChange
            ? undefined
            : { id: "change", revision: mocks.revision, status: mocks.status }
          : mocks.existing
            ? { id: "other" }
            : undefined,
      execute: async () =>
        table === "attachments"
          ? [{ repository_path: "static/img/a.png", storage_key: "stored" }]
          : activeQuery
            ? mocks.active
            : mocks.builds,
    };
    return builder;
  }
  return { ...(await original<typeof import("@pushdocs/db")>()), getDatabase: () => database };
});

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  vi.stubEnv("PUSHDOCS_PREVIEW_DOMAIN", "preview.example.test");
  vi.stubEnv("PUSHDOCS_PREVIEW_KEY", "test-key-with-at-least-32-characters");
  mocks.revision = 3;
  mocks.status = "open";
  mocks.noChange = false;
  mocks.existing = false;
  mocks.active = [];
  mocks.builds = [];
  mocks.access.mockResolvedValue({});
  mocks.context.mockResolvedValue({
    user: { id: "user" },
    store: { requireProjectAccess: mocks.access },
    config: parseProjectConfig(),
    state: {
      branch: { id: "branch", head_commit_sha: "sha" },
      changeSet: { id: "change", revision: 3, status: "open" },
      files: [
        { path: "docs/a.md", content: "# A", status: "modify" },
        { path: "docs/b.md", content: "B", status: "delete" },
        { path: "docs/clean.md", content: "clean", status: "clean" },
      ],
    },
  });
});
function post(revision = 3) {
  return POST(
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({ branch: "main", revision }),
    }),
    context,
  );
}
it("freezes the exact draft and attachment manifest without a Git commit", async () => {
  expect((await post()).status).toBe(200);
  expect(mocks.values).toHaveBeenCalledWith(
    expect.objectContaining({
      project_id: "project",
      branch: "main",
      sha: "sha",
      revision: 3,
      snapshot: expect.objectContaining({
        files: [
          { path: "docs/a.md", content: "# A" },
          { path: "docs/b.md", content: null },
        ],
        attachments: [{ repository_path: "static/img/a.png", storage_key: "stored" }],
      }),
    }),
  );
  expect(mocks.access).toHaveBeenCalledWith("user", "project", "document:write");
});
it("rejects a changed revision and duplicate active builds", async () => {
  mocks.revision = 4;
  expect((await post()).status).toBe(409);
  mocks.revision = 3;
  expect((await post(2)).status).toBe(409);
  mocks.existing = true;
  expect((await post()).status).toBe(400);
  expect(mocks.values).not.toHaveBeenCalled();
});
it("limits active preview builds across all branches of one project", async () => {
  mocks.active = [{ id: "one" }, { id: "two" }];
  const response = await post();
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("двух");
  expect(mocks.values).not.toHaveBeenCalled();
});
it("rejects an unconfigured runner or a conflicted change set", async () => {
  vi.stubEnv("PUSHDOCS_PREVIEW_DOMAIN", "");
  expect((await post()).status).toBe(400);
  vi.stubEnv("PUSHDOCS_PREVIEW_DOMAIN", "preview.example.test");
  const state = await mocks.context();
  state.state.changeSet.status = "conflicted";
  expect((await post()).status).toBe(400);
  expect(mocks.values).not.toHaveBeenCalled();
});
it("issues short-lived links only for successful builds and marks stale snapshots", async () => {
  mocks.builds = [
    { id: "build", sha: "sha", revision: 3, status: "ready", log: "Built" },
    { id: "failed", sha: "old", revision: 2, status: "failed", log: "Error" },
  ];
  const response = await GET(new Request("https://cms.test/api?branch=main"), context);
  const data = await response.json();
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  expect(data.builds[0]).toMatchObject({
    stale: false,
    url: expect.stringContaining("https://build.preview.example.test/?expires="),
  });
  expect(data.builds[1]).toMatchObject({ stale: true, url: null });
  vi.stubEnv("PUSHDOCS_PREVIEW_KEY", "");
  const disabled = await (
    await GET(new Request("https://cms.test/api?branch=main"), context)
  ).json();
  expect(disabled.configured).toBe(false);
  expect(disabled.builds[0].url).toBeNull();
});
it("returns access errors from authenticated context", async () => {
  mocks.context.mockRejectedValueOnce({ code: "ACCESS_DENIED" });
  expect((await GET(new Request("https://cms.test/api?branch=main"), context)).status).toBe(403);
});

it("rechecks sending state under the transaction lock", async () => {
  mocks.status = "submitting";
  expect((await post()).status).toBe(400);
  expect(mocks.values).not.toHaveBeenCalled();
});

it("builds a clean branch and provides a local HTTP link when explicitly configured", async () => {
  mocks.noChange = true;
  const current = await mocks.context();
  current.state.changeSet = undefined;
  expect((await post(0)).status).toBe(200);
  expect(mocks.values).toHaveBeenCalledWith(
    expect.objectContaining({ snapshot: expect.objectContaining({ attachments: [] }) }),
  );
  vi.stubEnv("PUSHDOCS_PREVIEW_SCHEME", "http");
  mocks.builds = [{ id: "build", sha: "sha", revision: 0, status: "ready" }];
  const response = await GET(new Request("https://cms.test/api"), context);
  expect((await response.json()).builds[0].url).toMatch(/^http:/);
});
