import { parseProjectConfig } from "@pushdocs/content";
import { beforeEach, expect, it, vi } from "vitest";
import sendsayExample from "../../../../../../../../docs/examples/sendsay-docs.pushdocs.json";

const mocks = vi.hoisted(() => ({
  context: vi.fn(),
  access: vi.fn(),
  stage: vi.fn(),
  attachments: vi.fn(),
}));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/workbench", async (original) => ({
  ...(await original<typeof import("@/lib/workbench")>()),
  localWorkbenchContext: mocks.context,
}));

import { GET, POST } from "./route";

const context = { params: Promise.resolve({ projectId: "project" }) };
beforeEach(() => {
  vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", "https://cms.test");
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
    directories: [],
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

it.each([undefined, "images", "markdown"])(
  "uses the project upload directory for modal mode %s",
  async (mode) => {
    const current = await mocks.context();
    mocks.context.mockResolvedValue({
      ...current,
      config: parseProjectConfig(
        JSON.stringify({ version: 1, media: { images: { directory: "static/media" } } }),
      ),
    });
    const query = new URLSearchParams({ branch: "main", document: "docs/forms/survey.mdx" });
    if (mode) query.set("mode", mode);
    const response = await GET(new Request(`https://cms.test/api?${query}`), context);
    expect(await response.json()).toMatchObject({
      uploadDirectory: mode ? "static/media/forms/survey" : "static/media",
    });
  },
);

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

it("uses ordinary gallery groups and upload defaults when Video has no dedicated storage", async () => {
  const current = await mocks.context();
  mocks.context.mockResolvedValue({
    ...current,
    config: parseProjectConfig(
      JSON.stringify({ version: 1, media: { images: { directory: "assets/{locale}/pictures" } } }),
    ),
    state: {
      ...current.state,
      branch: {
        repository_paths: [
          "assets/ru/pictures/demo.mp4",
          "assets/de/pictures/demo.mp4",
          "static/video/shared.mp4",
        ],
      },
    },
  });
  const response = await GET(
    new Request("https://cms.test/api?branch=main&document=docs/a.mdx&mode=video"),
    context,
  );
  expect(await response.json()).toMatchObject({
    directories: ["assets/ru/pictures", "assets/de/pictures"],
    uploadDirectory: "assets/ru/pictures/a",
  });
});

it.each(["images", "markdown", "video"])(
  "uses the English attachment root and omits the extra locale directory in %s mode",
  async (mode) => {
    const current = await mocks.context();
    const document =
      "i18n/en/docusaurus-plugin-content-docs/current/en/email-campaigns/drag-and-drop-editor.mdx";
    mocks.context.mockResolvedValue({
      ...current,
      config: parseProjectConfig(JSON.stringify(sendsayExample)),
      state: {
        ...current.state,
        files: [{ path: document, locale: "en", content: "# English", status: "clean" }],
      },
    });
    const response = await GET(
      new Request(
        `https://cms.test/api?${new URLSearchParams({ branch: "main", document, mode })}`,
      ),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      directories:
        mode === "video"
          ? ["staticLocalized/ru/video", "staticLocalized/en/video"]
          : mode === "images"
            ? ["staticLocalized/ru/img", "staticLocalized/en/img"]
            : [
                "staticLocalized/ru/img",
                "staticLocalized/en/img",
                "staticLocalized/ru/video",
                "staticLocalized/en/video",
              ],
      uploadDirectory: `staticLocalized/en/${mode === "video" ? "video" : "img"}/email-campaigns/drag-and-drop-editor`,
      locale: "en",
    });
  },
);

it.each([
  ["docs/forms/survey.mdx", "default", "ru", "static/img/forms/survey"],
  [
    "i18n/en/docusaurus-plugin-content-docs/current/forms/survey.mdx",
    "en",
    "en",
    "static/img/forms/survey",
  ],
])(
  "returns the article upload directory for %s",
  async (document, storedLocale, locale, uploadDirectory) => {
    const current = await mocks.context();
    current.state.branch.repository_paths = [
      "staticLocalized/ru/img/shared.png",
      "staticLocalized/en/img/shared.png",
    ];
    current.state.files = [
      { path: document, locale: storedLocale, content: "# Article", status: "clean" },
    ];
    const response = await GET(
      new Request(
        `https://cms.test/api?${new URLSearchParams({ branch: "main", document, mode: "images" })}`,
      ),
      context,
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ locale, uploadDirectory });
  },
);

it.each(["static/favicon.svg", "staticLocalized/ru/img/forms/filter.gif", "other/image.png"])(
  "deletes and restores existing media outside the upload directory: %s",
  async (path) => {
    const current = await mocks.context();
    current.state.branch.repository_paths.push(path);
    const request = (action: string) =>
      new Request("https://cms.test/api", {
        method: "POST",
        headers: { Origin: "https://cms.test" },
        body: JSON.stringify({ branch: "main", path, action, revision: 2 }),
      });
    expect((await POST(request("delete"), context)).status).toBe(200);
    expect(mocks.stage).toHaveBeenLastCalledWith(
      expect.objectContaining({ files: [{ path, content: null }], expectedRevision: 2 }),
    );
    expect((await POST(request("revert"), context)).status).toBe(200);
    expect(mocks.stage).toHaveBeenLastCalledWith(
      expect.objectContaining({ files: [{ path, revert: true }] }),
    );
  },
);

it("deletes current branch uploads but rejects uploads from another branch", async () => {
  mocks.attachments.mockResolvedValue([
    { change_set_id: "change", repository_path: "other/new.png" },
    { change_set_id: "another", repository_path: "other/private.png" },
  ]);
  const request = (path: string) =>
    new Request("https://cms.test/api", {
      method: "POST",
      headers: { Origin: "https://cms.test" },
      body: JSON.stringify({ branch: "main", path, action: "delete", revision: 2 }),
    });
  expect((await POST(request("other/new.png"), context)).status).toBe(200);
  const calls = mocks.stage.mock.calls.length;
  expect((await POST(request("other/private.png"), context)).status).toBe(400);
  expect(mocks.stage).toHaveBeenCalledTimes(calls);
});
