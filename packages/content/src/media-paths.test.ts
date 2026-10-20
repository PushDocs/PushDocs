import { expect, it } from "vitest";
import sendsayExample from "../../../docs/examples/sendsay-docs.pushdocs.json";
import { attachmentUploadDirectory, parseProjectConfig } from "./config";
import { attachmentSnippet, groupMediaAssets, mediaCatalog } from "./media";
import {
  mediaLocales,
  mediaReferenceCandidates,
  mediaRoots,
  repositoryMediaUrl,
} from "./media-paths";

it("uses the documented sendsay configuration for English uploads and ordered groups", () => {
  const config = parseProjectConfig(JSON.stringify(sendsayExample));
  const document = "i18n/en/docusaurus-plugin-content-docs/current/en/email-campaigns/editor.mdx";
  expect(attachmentUploadDirectory(config, "en", document)).toBe(
    "staticLocalized/en/img/email-campaigns/editor",
  );
  const paths = [
    "staticLocalized/ru/img/a.png",
    "staticLocalized/en/img/a.png",
    "static/img/a.png",
    "static/favicon.svg",
  ];
  const groups = groupMediaAssets(
    paths.map((path) => ({ path })),
    mediaRoots(config, "en")
      .filter((root) => root.group)
      .map((root) => root.directory),
  );
  expect(groups.map((group) => group.label)).toEqual([
    "Файлы · staticLocalized/ru/img",
    "Файлы · staticLocalized/en/img",
    "Другие файлы проекта",
  ]);
  expect(groups.flatMap((group) => group.assets)).toHaveLength(paths.length);
});

it("resolves localized videos with shared fallback using the documented source mapping", () => {
  const config = parseProjectConfig(JSON.stringify(sendsayExample));
  const paths = [
    "staticLocalized/en/video/forms/demo.mp4",
    "static/video/forms/demo.mp4",
    "static/video/forms/shared.mp4",
  ];
  const document = "i18n/en/docs/forms/editor.mdx";
  const catalog = mediaCatalog({
    config,
    locale: "en",
    document,
    paths,
    files: [
      {
        path: document,
        locale: "en",
        status: "clean",
        content: '<Video src="/en/video/forms/demo.mp4" />',
      },
    ],
    uploads: [],
  });
  expect(catalog.find((asset) => asset.path === paths[0])).toMatchObject({
    url: "/en/video/forms/demo.mp4",
    usages: [document],
  });
  expect(catalog.find((asset) => asset.path === paths[1])).toMatchObject({
    url: null,
    shadowedBy: paths[0],
  });
  expect(
    mediaReferenceCandidates(config, "en", document, "/en/video/forms/shared.mp4").find((path) =>
      paths.includes(path),
    ),
  ).toBe(paths[2]);
});

it("discovers gallery languages from configured storage and keeps fallback files in Other", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      defaultLocale: "fr",
      media: {
        images: {
          directory: "public-assets/{locale}/pictures",
          publicUrl: "/manual/{locale}/pictures",
        },
        video: { directory: "public-assets/{locale}/clips", publicUrl: "/manual/{locale}/clips" },
      },
    }),
  );
  const paths = [
    "public-assets/fr/pictures/a.png",
    "public-assets/de/pictures/a.png",
    "public-assets/de/clips/a.mp4",
    "static/img/shared.png",
    "static/video/shared.mp4",
    "static/favicon.svg",
    "unrelated/it/pictures/a.png",
  ];
  expect(mediaLocales(config, paths)).toEqual(["de", "fr"]);
  const roots = mediaRoots(config, "fr", mediaLocales(config, paths));
  const groups = groupMediaAssets(
    paths.map((path) => ({ path })),
    roots.filter((root) => root.group).map((root) => root.directory),
  );
  expect(groups.map((group) => group.label)).toEqual([
    "Файлы · public-assets/fr/pictures",
    "Файлы · public-assets/de/pictures",
    "Файлы · public-assets/de/clips",
    "Другие файлы проекта",
  ]);
  expect(groups.at(-1)?.assets.map((asset) => asset.path)).toEqual(paths.slice(3));
  expect(repositoryMediaUrl(config, "fr", paths[1] ?? "")).toBe("/manual/de/pictures/a.png");
});

it("uses a single Other group when only standard static directories are configured", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: { images: { directory: "static/img" }, video: { directory: "static/video" } },
    }),
  );
  expect(mediaRoots(config, "ru").filter((root) => root.group)).toEqual([]);
});

it("tracks translated public URLs to shared files even without localized assets in that language", () => {
  const config = parseProjectConfig(JSON.stringify(sendsayExample));
  const catalog = mediaCatalog({
    config,
    locale: "ru",
    document: "docs/a.mdx",
    paths: ["static/video/shared.mp4"],
    uploads: [],
    files: [
      { path: "docs/a.mdx", content: '<Video src="/de/video/shared.mp4" />', status: "clean" },
    ],
  });
  expect(catalog[0]?.usages).toEqual(["docs/a.mdx"]);
});

it("resolves arbitrary directories, locales and component bases consistently without project conventions", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      defaultLocale: "fr",
      media: {
        images: {
          directory: "public-assets/{locale}/illustrations",
          publicUrl: "/manual/{locale}/pictures",
        },
        documentPathPrefixes: { de: "translated/" },
        components: { DocMedia: { storage: "images", srcBase: "/manual/{locale}/pictures" } },
      },
    }),
  );
  const document = "i18n/de/docusaurus-plugin-content-docs/current/translated/guide/editor.mdx";
  expect(attachmentUploadDirectory(config, "de", document)).toBe(
    "public-assets/de/illustrations/guide/editor",
  );
  const paths = [
    "public-assets/fr/illustrations/guide/a.png",
    "public-assets/de/illustrations/guide/a.png",
    "static/img/shared.png",
  ];
  for (const path of paths) {
    const url = repositoryMediaUrl(config, "de", path);
    expect(url).toBeDefined();
    const snippet = attachmentSnippet({ path, url: url ?? "" }, config, "de", "DocMedia");
    const src = snippet.match(/src="([^"]+)"/)?.[1] ?? "";
    expect(
      mediaReferenceCandidates(config, "de", document, src, config.media.components.DocMedia).find(
        (candidate) => paths.includes(candidate),
      ),
    ).toBe(path);
  }
  const catalog = mediaCatalog({
    config,
    locale: "de",
    document,
    paths,
    uploads: [],
    files: [
      { path: document, locale: "de", status: "clean", content: '<DocMedia src="guide/a.png" />' },
    ],
  });
  expect(catalog.filter((asset) => asset.usages.length).map((asset) => asset.path)).toEqual([
    paths[1],
  ]);
  expect(
    mediaReferenceCandidates(
      config,
      "de",
      document,
      "shared.png",
      config.media.components.DocMedia,
    ).find((candidate) => paths.includes(candidate)),
  ).toBeUndefined();
});

it("uses standard DocMedia paths without inferring unconfigured localized directories", () => {
  const config = parseProjectConfig();
  expect(
    mediaReferenceCandidates(config, "en", "i18n/en/docs/a.mdx", "a.png", {
      storage: "images",
      srcBase: "/{locale}/img",
    }),
  ).toContain("static/img/a.png");
  expect(repositoryMediaUrl(config, "en", "arbitrary/ru/img/a.png")).toBeUndefined();
});

it("prevents inserting a shared asset whose public URL is shadowed by a localized file", () => {
  const config = parseProjectConfig(JSON.stringify(sendsayExample));
  const paths = ["staticLocalized/en/img/a.png", "static/img/a.png"];
  const catalog = mediaCatalog({
    config,
    locale: "en",
    document: "i18n/en/docs/a.mdx",
    paths,
    files: [],
    uploads: [],
  });
  expect(catalog.find((asset) => asset.path === paths[0])?.url).toBe("/en/img/a.png");
  expect(catalog.find((asset) => asset.path === paths[1])).toMatchObject({
    url: null,
    shadowedBy: paths[0],
  });
  const afterDeletion = mediaCatalog({
    config,
    locale: "en",
    document: "i18n/en/docs/a.mdx",
    paths,
    files: [{ path: paths[0] ?? "", content: "", status: "delete" }],
    uploads: [],
  });
  expect(afterDeletion.find((asset) => asset.path === paths[1])?.url).toBe("/en/img/a.png");
});

it("round-trips encoded public roots and filenames with literal percent signs", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "assets", publicUrl: "/my%20manual/pictures" },
        components: { DocMedia: { storage: "images", srcBase: "/my%20manual/pictures" } },
      },
    }),
  );
  const path = "assets/a%20 снимок.png";
  const url = repositoryMediaUrl(config, "ru", path) ?? "";
  const src =
    attachmentSnippet({ path, url }, config, "ru", "DocMedia").match(/src="([^"]+)"/)?.[1] ?? "";
  expect(src).toBe("a%2520%20%D1%81%D0%BD%D0%B8%D0%BC%D0%BE%D0%BA.png");
  expect(
    mediaReferenceCandidates(config, "ru", "docs/a.md", src, config.media.components.DocMedia),
  ).toContain(path);
  expect(mediaReferenceCandidates(config, "ru", "docs/a.md", url)).toContain(path);
});

it.each(["/my%20manual/{locale}/pictures", "pathname:///my%20manual/{locale}/pictures"])(
  "resolves a cross-language URL below the encoded public root %s",
  (publicUrl) => {
    const config = parseProjectConfig(
      JSON.stringify({
        version: 1,
        media: { images: { directory: "assets/{locale}/pictures", publicUrl } },
      }),
    );
    const path = "assets/en/pictures/a%20 file.png";
    const url = repositoryMediaUrl(config, "ru", path) ?? "";
    expect(url).toBe("/my%20manual/en/pictures/a%2520%20file.png");
    expect(mediaReferenceCandidates(config, "ru", "docs/a.mdx", url)).toContain(path);
  },
);

it("keeps standard static URLs independent of a custom storage mapping and component base", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "static/pictures", publicUrl: "/pictures" },
        components: { Illustration: { storage: "images", srcBase: "/img" } },
      },
    }),
  );
  const paths = ["static/img/logo.png", "static/pictures/logo.png"];
  const catalog = mediaCatalog({
    config,
    locale: "ru",
    document: "docs/a.mdx",
    paths,
    uploads: [],
    files: [
      {
        path: "docs/a.mdx",
        content: '<Illustration src="../pictures/logo.png" />',
        status: "clean",
      },
    ],
  });
  expect(catalog.map((asset) => [asset.path, asset.url, asset.shadowedBy, asset.usages])).toEqual([
    [paths[0], "/img/logo.png", undefined, []],
    [paths[1], "/pictures/logo.png", undefined, ["docs/a.mdx"]],
  ]);
  expect(
    attachmentSnippet(
      { path: paths[1] ?? "", url: "/pictures/logo.png" },
      config,
      "ru",
      "Illustration",
    ),
  ).toBe('<Illustration src="../pictures/logo.png" alt="logo.png" />');
});
