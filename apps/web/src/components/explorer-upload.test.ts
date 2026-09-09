import { parseProjectConfig } from "@pushdocs/content/config";
import { afterEach, expect, it, vi } from "vitest";
import { uploadExplorerFiles } from "./explorer-upload";

afterEach(() => vi.unstubAllGlobals());
const state = {
  revision: 0,
  config: parseProjectConfig(),
  repositoryPaths: [] as string[],
  files: [] as Array<{ path: string }>,
  uploads: [] as Array<{ path: string }>,
};
it("uploads text and binary files to the exact directory with fresh revisions and no overwrites", async () => {
  const request = vi.fn().mockResolvedValue(new Response('{"saved":true}'));
  request.mockImplementation(async () => new Response('{"saved":true}'));
  vi.stubGlobal("fetch", request);
  const reload = vi
    .fn()
    .mockResolvedValueOnce(state)
    .mockResolvedValueOnce({ ...state, revision: 1 })
    .mockResolvedValue({ ...state, revision: 2 });
  const result = await uploadExplorerFiles({
    files: [
      new File(["# Intro\r\n"], "intro.md"),
      new File([new Uint8Array([0, 255])], "image.png"),
    ],
    directory: "docs/nested",
    projectId: "p",
    branch: "feature/a",
    reload,
    onProgress: vi.fn(),
  });
  expect(JSON.parse(request.mock.calls[0]?.[1].body)).toMatchObject({
    branch: "feature/a",
    expectedRevision: 0,
    files: [{ path: "docs/nested/intro.md", content: "# Intro\r\n", createOnly: true }],
  });
  const query = new URL(request.mock.calls[1]?.[0], "https://local.test").searchParams;
  expect(Object.fromEntries(query)).toMatchObject({
    branch: "feature/a",
    path: "docs/nested/image.png",
    destination: "repository",
    revision: "1",
  });
  expect(result).toEqual({
    uploaded: ["docs/nested/intro.md", "docs/nested/image.png"],
    errors: [],
  });
  expect(reload).toHaveBeenCalledTimes(3);
});
it("preserves existing drafts, skips invalid text and continues with the remaining files", async () => {
  const request = vi.fn().mockImplementation(async () => new Response("{}"));
  vi.stubGlobal("fetch", request);
  const reload = vi.fn().mockResolvedValue({ ...state, uploads: [{ path: "a.png" }] });
  const result = await uploadExplorerFiles({
    files: [
      new File(["x"], "a.png"),
      new File([new Uint8Array([255])], "bad.md"),
      new File(["ok"], "new.md"),
    ],
    directory: "",
    projectId: "p",
    branch: "main",
    reload,
    onProgress: vi.fn(),
  });
  expect(result.uploaded).toEqual(["new.md"]);
  expect(result.errors).toHaveLength(2);
  expect(request).toHaveBeenCalledTimes(1);
});
