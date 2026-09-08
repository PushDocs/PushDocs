import { expect, it } from "vitest";
import { parseProjectConfig } from "./config";
import { mediaCatalog } from "./media";

it("combines repository media and uploads with branch-local deletions and possible usages", () => {
  const result = mediaCatalog({
    config: parseProjectConfig(),
    locale: "ru",
    document: "docs/intro.md",
    paths: ["static/img/old.png", "static/img/gone.gif", "docs/intro.md", "other/archive.zip"],
    files: [
      { path: "docs/intro.md", content: "![Image](/img/old.png)", status: "clean" },
      { path: "static/img/gone.gif", content: "", status: "delete" },
    ],
    uploads: [
      { path: "static/img/old.png", size: 50 },
      { path: "static/img/new.png", size: 100 },
    ],
  });
  expect(result).toEqual([
    { path: "other/archive.zip", url: null, status: "clean", size: null, usages: [] },
    { path: "static/img/gone.gif", url: "/img/gone.gif", status: "delete", size: null, usages: [] },
    { path: "static/img/new.png", url: "/img/new.png", status: "upload", size: 100, usages: [] },
    {
      path: "static/img/old.png",
      url: "/img/old.png",
      status: "upload",
      size: 50,
      usages: ["docs/intro.md"],
    },
  ]);
});
