import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseProjectConfig } from "@pushdocs/content";
import { RevisionConflictError } from "@pushdocs/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  record: vi.fn(),
  access: vi.fn(),
  asset: vi.fn(),
  conflict: vi.fn(),
  binary: vi.fn(),
  begin: vi.fn(),
  finish: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workbench", async (original) => ({
  ...(await original<typeof import("@/lib/workbench")>()),
  workbenchContext: mocks.context,
}));
vi.mock("@pushdocs/db", async (original) => ({
  ...(await original<typeof import("@pushdocs/db")>()),
  getDatabase: () => ({
    selectFrom: (table: string) => {
      const query = {
        select: () => query,
        selectAll: () => query,
        where: () => query,
        executeTakeFirst: table === "change_set_conflicts" ? mocks.conflict : mocks.asset,
      };
      return query;
    },
  }),
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
let directory: string;
let state: {
  branch: { head_commit_sha: string; repository_paths: string[] };
  changeSet?: { id: string; status: string };
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-assets-route-"));
  vi.stubEnv("PUSHDOCS_ATTACHMENTS_DIR", directory);
  state = {
    branch: { head_commit_sha: "sha", repository_paths: [] },
    changeSet: { id: "change", status: "open" },
  };
  mocks.asset.mockResolvedValue(undefined);
  mocks.conflict.mockResolvedValue(undefined);
  mocks.record.mockResolvedValue({});
  mocks.binary.mockResolvedValue(Buffer.from([0, 255]));
  mocks.access.mockResolvedValue({});
  mocks.begin.mockResolvedValue({ id: "upload" });
  mocks.finish.mockResolvedValue(undefined);
  mocks.context.mockImplementation(async () => ({
    config: parseProjectConfig(),
    user: { id: "user" },
    store: {
      requireProjectAccess: mocks.access,
      recordAttachment: mocks.record,
      beginUpload: mocks.begin,
      finishUpload: mocks.finish,
    },
    state,
    provider: { readBinary: mocks.binary },
    target: { root_path: ".", provider_repository_id: "42" },
  }));
});
afterEach(async () => {
  await rm(directory, { recursive: true });
});
function upload(extra: Record<string, string> = {}, body: BodyInit = "image") {
  return POST(
    new Request(
      `https://cms.test/api?${new URLSearchParams({ branch: "main", name: "a.png", locale: "ru", document: "docs/a.md", revision: "0", ...extra })}`,
      { method: "POST", headers: { Origin: "https://cms.test" }, body },
    ),
    context,
  );
}
it("streams a file and returns the URL for a nested custom directory", async () => {
  const response = await upload({ path: "static/img/guides/a.png" });
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    path: "static/img/guides/a.png",
    url: "/img/guides/a.png",
    size: 5,
  });
  const record = mocks.record.mock.calls[0]?.[0];
  expect(record).toMatchObject({
    branch: "main",
    expectedRevision: 0,
    mediaType: "image/png",
    sizeBytes: 5,
  });
  expect(await readFile(path.join(directory, record.storageKey), "utf8")).toBe("image");
  expect(mocks.begin).toHaveBeenCalledWith({
    branch: "main",
    projectId: "project",
    userId: "user",
    expectedRevision: 0,
  });
  expect(mocks.finish).toHaveBeenCalledWith("upload", "project");
});
it("can read the Git version independently of an uploaded replacement", async () => {
  state.branch.repository_paths = ["static/img/a.png"];
  mocks.asset.mockResolvedValue({ storage_key: "must-not-read" });
  const response = await GET(
    new Request("https://cms.test/api?branch=main&path=static/img/a.png&version=git"),
    context,
  );
  expect(response.status).toBe(200);
  expect(mocks.binary).toHaveBeenCalledWith("42", "sha", "static/img/a.png");
});
it("shows an upstream binary addition from its conflict SHA even before the tree is reimported", async () => {
  state.changeSet = { id: "change", status: "conflicted" };
  mocks.conflict.mockResolvedValue({ theirs_content: "hash", theirs_head_sha: "conflict-sha" });
  const response = await GET(
    new Request("https://cms.test/api?branch=main&path=static/img/new.png&version=git"),
    context,
  );
  expect(response.status).toBe(200);
  expect(mocks.binary).toHaveBeenCalledWith("42", "conflict-sha", "static/img/new.png");
});
it("requires explicit replacement and respects sending state", async () => {
  state.branch.repository_paths = ["static/img/a.png"];
  expect((await upload()).status).toBe(400);
  expect((await upload({ replace: "true" })).status).toBe(200);
  state.changeSet = { id: "change", status: "submitting" };
  expect((await upload({ replace: "true" })).status).toBe(400);
});
it("rejects invalid targets, unsupported files, missing bodies and oversized files", async () => {
  expect((await upload({ path: "docs/a.png" })).status).toBe(400);
  expect((await upload({ path: "../a.png" })).status).toBe(400);
  expect((await upload({ name: "a.exe" })).status).toBe(400);
  const empty = new Request("https://cms.test/api?branch=main&name=a.png", {
    method: "POST",
    headers: { Origin: "https://cms.test" },
  });
  expect((await POST(empty, context)).status).toBe(400);
  vi.stubEnv("PUSHDOCS_UPLOAD_LIMIT_MIB", "1");
  expect((await upload({}, new Uint8Array(1024 * 1024 + 1))).status).toBe(400);
});
it("removes bytes if the revision check fails after streaming", async () => {
  mocks.record.mockRejectedValueOnce(new RevisionConflictError("stale"));
  expect((await upload()).status).toBe(409);
  const record = mocks.record.mock.calls[0]?.[0];
  await expect(readFile(path.join(directory, record.storageKey))).rejects.toThrow();
});
it("serves existing Git bytes at an immutable SHA with safe response headers", async () => {
  state.changeSet = undefined;
  state.branch.repository_paths = ["static/img/a.png"];
  const response = await GET(
    new Request("https://cms.test/api?branch=main&path=static/img/a.png"),
    context,
  );
  expect(response.status).toBe(200);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
  expect(mocks.binary).toHaveBeenCalledWith("42", "sha", "static/img/a.png");
  expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0, 255]));
});
it("serves uploaded SVG as a download and rejects missing files", async () => {
  await upload({ name: "a.svg" }, "<svg />");
  const record = mocks.record.mock.calls[0]?.[0];
  mocks.asset.mockResolvedValueOnce({ storage_key: record.storageKey });
  const response = await GET(
    new Request("https://cms.test/api?branch=main&path=static/img/a.svg"),
    context,
  );
  expect(response.headers.get("Content-Disposition")).toBe("attachment");
  expect(await response.text()).toBe("<svg />");
  expect(
    (
      await GET(
        new Request("https://cms.test/api?branch=main&path=static/img/missing.png"),
        context,
      )
    ).status,
  ).toBe(400);
});

it("rejects oversized declared lengths before writing bytes", async () => {
  const response = await POST(
    new Request("https://cms.test/api?branch=main&name=a.png", {
      method: "POST",
      body: "image",
      headers: { Origin: "https://cms.test", "Content-Length": "999999999" },
    }),
    context,
  );
  expect(response.status).toBe(400);
  expect(await response.json()).toEqual({ error: "Файл превышает лимит загрузки" });
  expect(mocks.record).not.toHaveBeenCalled();
});

it("uses project-relative paths for Git assets and validates missing parameters", async () => {
  const current = await mocks.context();
  current.target.root_path = "website";
  mocks.context.mockResolvedValueOnce(current);
  state.branch.repository_paths = ["static/img/a.png"];
  expect(
    (await GET(new Request("https://cms.test/api?path=static/img/a.png"), context)).status,
  ).toBe(200);
  expect(mocks.binary).toHaveBeenCalledWith("42", "sha", "website/static/img/a.png");
  expect((await GET(new Request("https://cms.test/api"), context)).status).toBe(400);
  expect(
    (
      await POST(
        new Request("https://cms.test/api", {
          method: "POST",
          headers: { Origin: "https://cms.test" },
        }),
        context,
      )
    ).status,
  ).toBe(400);
});

it("uses the scoped local data directory when no storage override is configured", async () => {
  vi.stubEnv("PUSHDOCS_ATTACHMENTS_DIR", undefined);
  vi.spyOn(process, "cwd").mockReturnValue(directory);
  expect((await upload()).status).toBe(200);
  const record = mocks.record.mock.calls[0]?.[0];
  mocks.asset.mockResolvedValueOnce({ storage_key: record.storageKey });
  const response = await GET(new Request("https://cms.test/api?path=static/img/a.png"), context);
  expect(await response.text()).toBe("image");
});

it("uploads explorer assets at the requested repository location without media-root redirection", async () => {
  for (const filePath of ["logo.png", "docs/guide/logo.png"]) {
    const response = await upload({ destination: "repository", path: filePath });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ path: filePath, url: null });
    expect(mocks.record).toHaveBeenLastCalledWith(
      expect.objectContaining({ repositoryPath: filePath, createOnly: true }),
    );
  }
  expect((await upload({ destination: "repository", path: "../logo.png" })).status).toBe(400);
  expect((await upload({ destination: "repository", path: ".git/config.png" })).status).toBe(400);
  expect((await upload({ destination: "repository", path: "config.json" })).status).toBe(400);
});
