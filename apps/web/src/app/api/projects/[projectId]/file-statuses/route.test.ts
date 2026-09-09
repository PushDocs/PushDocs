import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ context: vi.fn(), compare: vi.fn(), attachments: vi.fn() }));
vi.mock("@/lib/workbench", () => ({
  workbenchContext: mocks.context,
  apiError: () => Response.json({ error: "Failed" }, { status: 400 }),
}));

import { GET } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  const snapshot = {
    state: {
      branch: { head_commit_sha: "sha", repository_paths: ["logo.png"] },
      changeSet: { id: "draft" },
    },
    target: { default_branch: "stable", provider_repository_id: "9", root_path: "site" },
    provider: { compareFiles: mocks.compare },
    store: { listAttachments: mocks.attachments },
  };
  mocks.context.mockResolvedValue(snapshot);
  mocks.compare.mockResolvedValue([
    { path: "site/docs/a.md", status: "add" },
    { path: "other/a.md", status: "modify" },
  ]);
  mocks.attachments.mockResolvedValue([
    { change_set_id: "draft", repository_path: "logo.png" },
    { change_set_id: "other", repository_path: "other.png" },
  ]);
});
const get = (branch: string, projectId: string) =>
  GET(new Request(`https://cms.test?branch=${branch}`), { params: Promise.resolve({ projectId }) });
it("compares the imported head, scopes paths to the project and includes current uploads", async () => {
  const response = await get("feature", "comparison");
  expect(await response.json()).toEqual({
    statuses: { "docs/a.md": "add", "logo.png": "modify" },
    base: "stable",
    sha: "sha",
  });
  expect(mocks.compare).toHaveBeenCalledWith("9", "stable", "sha");
  await get("feature", "comparison");
  expect(mocks.compare).toHaveBeenCalledTimes(1);
  expect(mocks.attachments).toHaveBeenCalledTimes(2);
});
it("skips Git comparison on the default branch and never returns a failed comparison as clean", async () => {
  expect(await (await get("stable", "default")).json()).toMatchObject({
    statuses: { "logo.png": "modify" },
  });
  expect(mocks.compare).not.toHaveBeenCalled();
  mocks.compare.mockRejectedValue(new Error("offline"));
  expect((await get("feature", "failure")).status).toBe(400);
});
