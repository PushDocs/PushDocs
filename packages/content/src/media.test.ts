import { expect, it } from "vitest";
import { parseProjectConfig } from "./config";
import { mediaCatalog } from "./media";

it("provides insertable links beyond the upload directory, including localized media", () => {
  const result = mediaCatalog({
    config: parseProjectConfig(
      JSON.stringify({
        version: 1,
        media: {
          directory: "staticLocalized/{locale}/img/{documentDir}",
          publicUrl: "pathname:///img/{documentDir}",
        },
      }),
    ),
    locale: "ru",
    document: "docs/ecom/ecom-statistics.mdx",
    paths: [
      "staticLocalized/ru/img/ecom/a.png",
      "staticLocalized/ru/img/forms/filter.gif",
      "static/favicon.svg",
      "other/архив с данными.zip",
    ],
    files: [],
    uploads: [],
  });
  expect(result).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "staticLocalized/ru/img/ecom/a.png",
        url: "pathname:///img/ecom/a.png",
        canDelete: true,
      }),
      expect.objectContaining({
        path: "staticLocalized/ru/img/forms/filter.gif",
        url: "pathname:///img/forms/filter.gif",
        canDelete: false,
      }),
      expect.objectContaining({
        path: "static/favicon.svg",
        url: "/favicon.svg",
        canDelete: false,
      }),
      expect.objectContaining({
        path: "other/архив с данными.zip",
        url: "../../other/%D0%B0%D1%80%D1%85%D0%B8%D0%B2%20%D1%81%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%BC%D0%B8.zip",
        canDelete: false,
      }),
    ]),
  );
});

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
    {
      path: "other/archive.zip",
      url: "../other/archive.zip",
      canDelete: false,
      status: "clean",
      size: null,
      usages: [],
    },
    {
      path: "static/img/gone.gif",
      url: "/img/gone.gif",
      canDelete: true,
      status: "delete",
      size: null,
      usages: [],
    },
    {
      path: "static/img/new.png",
      url: "/img/new.png",
      canDelete: true,
      status: "upload",
      size: 100,
      usages: [],
    },
    {
      path: "static/img/old.png",
      url: "/img/old.png",
      canDelete: true,
      status: "upload",
      size: 50,
      usages: ["docs/intro.md"],
    },
  ]);
});
