import { parseProjectConfig } from "@pushdocs/content";
import { RevisionConflictError } from "@pushdocs/db";
import { AccessDeniedError } from "@pushdocs/domain";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  access: vi.fn(),
  stage: vi.fn(),
  create: vi.fn(),
  sync: vi.fn(),
  ensure: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workbench", async (original) => ({
  ...(await original<typeof import("@/lib/workbench")>()),
  workbenchContext: mocks.context,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
let role = "editor";
beforeEach(() => {
  role = "editor";
  mocks.access.mockImplementation(async (_user, _project, action) => {
    if (role === "reader") throw new AccessDeniedError(action);
  });
  mocks.stage.mockResolvedValue(undefined);
  mocks.create.mockResolvedValue({ name: "docs/new", sha: "sha" });
  mocks.context.mockImplementation(async () => ({
    store: {
      requireProjectAccess: mocks.access,
      stageFiles: mocks.stage,
      enqueueBranchSync: mocks.sync,
      ensureBranch: mocks.ensure,
      listBranches: async () => [{ full_ref: "main" }],
      listAttachments: async () => [
        { repository_path: "static/img/new.png", change_set_id: "change" },
        { repository_path: "other.png", change_set_id: "other" },
      ],
    },
    user: { id: "user" },
    access: { role },
    target: { provider_repository_id: "42" },
    provider: { createBranch: mocks.create },
    state: {
      branch: { head_commit_sha: "sha", repository_paths: [] },
      files: [],
      changeSet: { revision: 7, status: "open", id: "change" },
    },
    config: parseProjectConfig(
      '{"version":1,"templates":[{"id":"doc","label":"Doc","path":"docs/{slug}.md","content":"# {title}"}]}',
    ),
  }));
});
function request(payload: unknown, origin = "https://cms.test") {
  return POST(
    new Request("https://cms.test/api", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: { Origin: origin },
    }),
    context,
  );
}
it("returns branch state without caching or credentials", async () => {
  const response = await GET(new Request("https://cms.test/api?branch=main"), context);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const data = await response.json();
  expect(data).toMatchObject({ revision: 7, changeSetId: "change", sha: "sha", role: "editor" });
  expect(data.provider).toBeUndefined();
  expect(data.uploads).toEqual([{ path: "static/img/new.png" }]);
});
it("creates a branch from the chosen SHA and queues its import", async () => {
  expect(
    (await request({ action: "branch", branch: "main", name: "docs/new", sha: "sha" })).status,
  ).toBe(200);
  expect(mocks.create).toHaveBeenCalledWith("42", "docs/new", "sha");
  expect(mocks.sync).toHaveBeenCalledWith("project", "docs/new");
  expect(
    (await request({ action: "branch", branch: "main", name: "docs/new", sha: "old" })).status,
  ).toBe(400);
  expect(mocks.create).toHaveBeenCalledTimes(1);
});
it("queues synchronization without writing to Git", async () => {
  role = "reader";
  expect((await request({ action: "sync", branch: "main" })).status).toBe(200);
  expect(mocks.sync).toHaveBeenCalledWith("project", "main");
  expect(mocks.create).not.toHaveBeenCalled();
});
it("stages multiple files with a single revision check", async () => {
  const files = [
    { path: "docs/old.md", content: null },
    { path: "docs/new.md", content: "# New", createOnly: true },
  ];
  expect(
    (await request({ action: "files", branch: "main", expectedRevision: 7, files })).status,
  ).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith({
    projectId: "project",
    branch: "main",
    userId: "user",
    expectedRevision: 7,
    files,
  });
});
it("plans a template before applying it", async () => {
  const command = {
    action: "template",
    branch: "main",
    expectedRevision: 7,
    templateId: "doc",
    values: { slug: "new", title: "New" },
  };
  const plan = await (await request(command)).json();
  expect(plan).toEqual({
    files: [{ path: "docs/new.md", content: "# New", createOnly: true }],
    planDigest: expect.stringMatching(/^[a-f0-9]{64}$/),
  });
  expect(mocks.stage).not.toHaveBeenCalled();
  expect((await request({ ...command, apply: true })).status).toBe(400);
  expect((await request({ ...command, apply: true, planDigest: "stale" })).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
  expect((await request({ ...command, apply: true, planDigest: plan.planDigest })).status).toBe(
    200,
  );
  expect(mocks.stage).toHaveBeenCalledOnce();
});
it("invalidates a companion plan if another editor changed its source before applying", async () => {
  const current = await mocks.context();
  mocks.context.mockResolvedValue(current);
  current.config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: "doc",
          label: "Doc",
          path: "docs/{slug}.md",
          content: "# {title}",
          updates: [
            {
              path: "docs/index.mdx",
              find: "// insert",
              replace: "import New from './{slug}.md';",
            },
          ],
        },
      ],
    }),
  );
  current.state.files = [
    { path: "docs/index.mdx", content: "// insert\n<Existing />", status: "clean" },
    { path: "docs/deleted.md", content: "Gone", status: "delete" },
  ];
  const command = {
    action: "template",
    branch: "main",
    expectedRevision: 7,
    templateId: "doc",
    values: { slug: "new", title: "New" },
  };
  const plan = await (await request(command)).json();
  expect(plan.files[1]).toEqual({
    path: "docs/index.mdx",
    content: "import New from './new.md';\n<Existing />",
    createOnly: false,
  });
  current.state.files[0].content += "\nAnother editor";
  const response = await request({ ...command, apply: true, planDigest: plan.planDigest });
  expect(response.status).toBe(400);
  expect((await response.json()).error).toContain("План изменился");
  expect(mocks.stage).not.toHaveBeenCalled();
});
it("rejects unsafe paths, unauthorised writes and stale revisions", async () => {
  const command = {
    action: "files",
    branch: "main",
    expectedRevision: 7,
    files: [{ path: "docs/a.md", content: "# A" }],
  };
  role = "reader";
  expect((await request(command)).status).toBe(403);
  role = "editor";
  expect(
    (await request({ ...command, files: [{ path: ".pushdocs/config.json", revert: true }] }))
      .status,
  ).toBe(400);
  expect(
    (await request({ ...command, files: [{ path: "../secret", content: "bad" }] })).status,
  ).toBe(400);
  expect((await request(command, "https://evil.test")).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
  mocks.stage.mockRejectedValueOnce(new RevisionConflictError("stale"));
  expect((await request(command)).status).toBe(409);
});
it("validates new configuration before staging", async () => {
  role = "admin";
  const command = {
    action: "files",
    branch: "main",
    expectedRevision: 7,
    files: [{ path: ".pushdocs/config.json", content: '{"version":2}' }],
  };
  expect((await request(command)).status).toBe(400);
  expect(mocks.stage).not.toHaveBeenCalled();
  command.files[0] = { path: ".pushdocs/config.json", content: '{"version":1}' };
  expect((await request(command)).status).toBe(200);
});

it("reports read failures and rejects oversized commands before reading", async () => {
  mocks.context.mockRejectedValueOnce(new Error("offline"));
  expect((await GET(new Request("https://cms.test/api"), context)).status).toBe(400);
  const response = await POST(
    new Request("https://cms.test/api", {
      method: "POST",
      body: "{}",
      headers: { "Content-Length": "9000000", Origin: "https://cms.test" },
    }),
    context,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Запрос слишком большой" });
});

it("returns an open revision for a branch without drafts", async () => {
  const current = await mocks.context();
  current.state.changeSet = undefined;
  mocks.context.mockResolvedValueOnce(current);
  expect(await (await GET(new Request("https://cms.test/api"), context)).json()).toMatchObject({
    revision: 0,
    status: "open",
  });
});

it("stages an empty folder as a Git marker and rejects unsafe or occupied paths", async () => {
  expect(
    (await request({ action: "folder", branch: "main", expectedRevision: 7, path: "docs/guides" }))
      .status,
  ).toBe(200);
  expect(mocks.stage).toHaveBeenCalledWith(
    expect.objectContaining({
      files: [{ path: "docs/guides/.gitkeep", content: "", createOnly: true }],
      expectedRevision: 7,
    }),
  );
  expect(
    (await request({ action: "folder", branch: "main", expectedRevision: 7, path: "../bad" }))
      .status,
  ).toBe(400);
  const snapshot = await mocks.context();
  snapshot.state.branch.repository_paths = ["docs/existing.md"];
  mocks.context.mockResolvedValue(snapshot);
  for (const path of ["docs", "docs/existing.md/child"])
    expect(
      (await request({ action: "folder", branch: "main", expectedRevision: 7, path })).status,
    ).toBe(400);
  role = "reader";
  expect(
    (await request({ action: "folder", branch: "main", expectedRevision: 7, path: "new" })).status,
  ).toBe(403);
});
it("reads only known repository paths at the imported revision without allowing code execution", async () => {
  const snapshot = await mocks.context();
  snapshot.target.root_path = "website";
  snapshot.state.branch.repository_paths = ["src/app.ts", "image.png"];
  const readBinary = vi.fn().mockResolvedValue(Buffer.from("export const a = 1;"));
  snapshot.provider.readBinary = readBinary;
  mocks.context.mockResolvedValue(snapshot);
  const get = (path: string, download = false) =>
    GET(
      new Request(
        `https://cms.test/api?${new URLSearchParams({ branch: "main", path, ...(download ? { download: "1" } : {}) })}`,
      ),
      context,
    );
  expect(await (await get("src/app.ts")).json()).toEqual({ content: "export const a = 1;" });
  expect(readBinary).toHaveBeenCalledWith("42", "sha", "website/src/app.ts");
  expect((await get("../secret")).status).toBe(400);
  expect((await get("missing.ts")).status).toBe(400);
  expect(readBinary).toHaveBeenCalledTimes(1);
  readBinary.mockResolvedValue(Buffer.from([0, 255, 0]));
  expect(await (await get("image.png")).json()).toEqual({ content: null });
  const response = await get("src/app.ts", true);
  expect(response.headers.get("Content-Type")).toBe("application/octet-stream");
  expect(response.headers.get("Content-Disposition")).toContain("attachment");
  expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
});
