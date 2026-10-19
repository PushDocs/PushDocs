import { expect, it } from "vitest";
import sendsayExample from "../../../docs/examples/sendsay-docs.pushdocs.json";
import {
  attachmentUploadDirectory,
  isEditableFile,
  mediaComponentBaseUrl,
  parseProjectConfig,
  planDocument,
  planTemplate,
  safePath,
} from "./config";

it("validates the optional preview output path", () => {
  expect(
    parseProjectConfig(JSON.stringify({ version: 1, preview: { output: "build/index.html" } }))
      .preview?.output,
  ).toBe("build/index.html");
  expect(() =>
    parseProjectConfig(JSON.stringify({ version: 1, preview: { output: "../outside" } })),
  ).toThrow("Недопустимый путь");
});

it("plans an article and exact companion edits together without rewriting unrelated source", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: "release",
          label: "Release",
          path: "docs/{slug}.mdx",
          content: "# {title}\n",
          updates: [
            {
              path: "docs/index.mdx",
              find: "export const releases = [",
              replace: "import Release from './{slug}.mdx';\nexport const releases = [Release,",
            },
          ],
        },
      ],
    }),
  );
  const index = "// Keep this comment\nexport const releases = [Previous];\n<Index />\n";
  expect(
    planTemplate(
      config,
      "release",
      { slug: "september", title: "September" },
      new Map([["docs/index.mdx", index]]),
    ),
  ).toEqual([
    { path: "docs/september.mdx", content: "# September\n", createOnly: true },
    {
      path: "docs/index.mdx",
      content:
        "// Keep this comment\nimport Release from './september.mdx';\nexport const releases = [Release,Previous];\n<Index />\n",
      createOnly: false,
    },
  ]);
  expect(() =>
    planTemplate(config, "release", { slug: "september", title: "September" }, new Map()),
  ).toThrow("не найден");
  expect(() =>
    planTemplate(
      config,
      "release",
      { slug: "september", title: "September" },
      new Map([["docs/index.mdx", index + index]]),
    ),
  ).toThrow("неоднознач");
});
it("refuses unsafe or oversized companion updates and preserves CRLF through successive edits", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: "t",
          label: "T",
          path: "docs/new.md",
          content: "# New",
          updates: [
            { path: "docs/index.mdx", find: "first\n", replace: "next\n" },
            { path: "docs/index.mdx", find: "next", replace: "final" },
          ],
        },
      ],
    }),
  );
  expect(
    planTemplate(config, "t", {}, new Map([["docs/index.mdx", "first\r\n<Widget />\r\n"]]))[1]
      ?.content,
  ).toBe("final\r\n<Widget />\r\n");
  expect(() => planTemplate(config, "t", {}, new Map([["docs/index.mdx", "different"]]))).toThrow(
    "не подходит",
  );
  const template = config.templates[0];
  if (!template?.updates) throw new Error("fixture");
  template.updates[0] = { path: "docs/new.md", find: "New", replace: "Changed" };
  expect(() => planTemplate(config, "t", {}, new Map())).toThrow("одновременно");
  template.updates = [{ path: "docs/large.md", find: "x", replace: "longer" }];
  expect(() =>
    planTemplate(config, "t", {}, new Map([["docs/large.md", `x${" ".repeat(5_000_000)}`]])),
  ).toThrow("лимит");
});

it("uses conventional Docusaurus paths without configuration", () => {
  const config = parseProjectConfig();
  expect(attachmentUploadDirectory(config)).toBe("static/img");
  expect(mediaComponentBaseUrl(config, "ru", "docmedia")).toBe("/img");
  expect(mediaComponentBaseUrl(config, "en", "docmedia")).toBe("/en/img");
});

it("uses image and video storage directly for component uploads and public URLs", () => {
  const config = parseProjectConfig(JSON.stringify(sendsayExample));
  const document = "i18n/en/docs/en/forms/editor.mdx";
  expect(attachmentUploadDirectory(config, "en", document, "docmedia")).toBe(
    "staticLocalized/en/img/forms/editor",
  );
  expect(attachmentUploadDirectory(config, "en", document, "video")).toBe(
    "staticLocalized/en/video/forms/editor",
  );
  expect(config.media.images?.publicUrl).toBe("/{locale}/img");
  expect(config.media.video?.publicUrl).toBe("/{locale}/video");
  expect(mediaComponentBaseUrl(config, "ru", "video")).toBe("/video");
  expect(mediaComponentBaseUrl(config, "en", "video")).toBe("/en/video");
  expect(config.media).not.toHaveProperty("sources");
  expect(parseProjectConfig(JSON.stringify(config))).toEqual(config);
});

it.each([
  { images: { directory: "../outside" } },
  { video: { directory: ".git/videos" } },
  { images: { directory: "assets/{unknown}" } },
  { images: { directory: "assets/{localePrefix}/img" } },
  { images: { directory: "assets/{documentDir}" } },
  { images: { directory: "assets", publicUrl: "/{localePrefix}img" } },
  { documentPathPrefixes: { en: "../en" } },
  { video: { directory: "assets/{locale}", publicUrl: "//outside.test" } },
  { video: { directory: "assets", publicUrl: "/{locale}/%2e%2e/video" } },
  { images: { directory: "assets", group: false } },
  { images: { directory: "assets", fallbackDirectories: ["static/img"] } },
  { images: { directory: "assets" }, directory: "legacy" },
  { sources: { images: { directory: "assets", publicUrl: "/img" } } },
  { components: { Video: "videos" } },
])("rejects unsafe media paths, manual groups and mixed formats: %j", (media) => {
  expect(() =>
    parseProjectConfig(
      JSON.stringify({
        version: 1,
        media,
      }),
    ),
  ).toThrow();
});

it("defaults public URLs and uses the ordinary upload destination when video is not configured", () => {
  const config = parseProjectConfig(
    JSON.stringify({ version: 1, media: { images: { directory: "assets/{locale}/pictures" } } }),
  );
  expect(config.media.images?.publicUrl).toBe("/{locale}/img");
  expect(attachmentUploadDirectory(config, "ru", "docs/a.mdx", "video")).toBe(
    "assets/ru/pictures/a",
  );
  expect(mediaComponentBaseUrl(config, "en", "docmedia")).toBe("/en/img");
});

it.each([
  { directory: "static/img" },
  { publicUrl: "/img" },
  { upload: { directory: "static/img" } },
  { roots: [{ directory: "static", publicUrl: "/", locales: ["ru", "en"], group: false }] },
  { docMedia: { baseUrl: "/img" } },
])("rejects removed media fields: %j", (media) => {
  expect(() => parseProjectConfig(JSON.stringify({ version: 1, media }))).toThrow(
    /Unrecognized key/,
  );
});

it.each([
  "docs/forms/survey.mdx",
  "i18n/en/docusaurus-plugin-content-docs/current/forms/survey.mdx",
  "i18n/en/docusaurus-plugin-content-docs/version-2.0/forms/survey.mdx",
  "versioned_docs/version-2.0/forms/survey.mdx",
])("appends the article path to the configured upload root for %s", (document) => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "assets/{locale}/pictures" },
        documentPathPrefixes: { de: "translated/" },
      },
    }),
  );
  expect(attachmentUploadDirectory(config, "de", document)).toBe("assets/de/pictures/forms/survey");
  expect(attachmentUploadDirectory(config, "de", "i18n/de/docs/translated/forms/survey.mdx")).toBe(
    "assets/de/pictures/forms/survey",
  );
});

it("uses only explicitly configured document prefixes and preserves shared paths", () => {
  expect(attachmentUploadDirectory(parseProjectConfig())).toBe("static/img");
  expect(
    attachmentUploadDirectory(parseProjectConfig(), "en", "i18n/en/docs/en/forms/editor.mdx"),
  ).toBe("static/img/en/forms/editor");
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "assets/{locale}/pictures" },
        documentPathPrefixes: { en: "en/" },
      },
    }),
  );
  expect(attachmentUploadDirectory(config, "en", "i18n/en/docs/en/forms/editor.mdx")).toBe(
    "assets/en/pictures/forms/editor",
  );
  expect(attachmentUploadDirectory(config, "ru", "docs/en/forms/editor.mdx")).toBe(
    "assets/ru/pictures/en/forms/editor",
  );
  expect(attachmentUploadDirectory(config, "en")).toBe("assets/en/pictures");
  expect(() => attachmentUploadDirectory(config, "../en", "docs/article.mdx")).toThrow("локаль");
});

it("creates a document and its declared companion without repository-specific code", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: "article",
          label: "Article",
          path: "docs/{slug}.md",
          content: "# {title}\n",
          companions: [
            { path: "i18n/{locale}/docs/{slug}.md", content: "# Translation of {title}\n" },
          ],
        },
      ],
    }),
  );
  expect(
    planDocument(config, "article", { slug: "intro", title: "Introduction", locale: "en" }),
  ).toEqual([
    { path: "docs/intro.md", content: "# Introduction\n" },
    { path: "i18n/en/docs/intro.md", content: "# Translation of Introduction\n" },
  ]);
});

it.each([
  "../secret",
  "/etc/passwd",
  "docs/../secret",
  "docs\\secret",
  ".git/config",
  "docs//file",
  "docs/./file",
])("rejects unsafe repository path %s", (path) => {
  expect(() => safePath(path)).toThrow();
});

it("rejects unsupported config versions instead of silently using defaults", () => {
  expect(() => parseProjectConfig('{"version":2}')).toThrow();
});
it("accepts repository-defined metadata fields but rejects duplicate and unsafe names", () => {
  const field = { name: "audience", label: "Audience", type: "string" };
  expect(parseProjectConfig(JSON.stringify({ version: 1, metadata: [field] })).metadata).toEqual([
    field,
  ]);
  for (const fields of [
    [field, field],
    [{ ...field, name: "constructor" }],
    [{ ...field, name: "bad:name" }],
  ])
    expect(() => parseProjectConfig(JSON.stringify({ version: 1, metadata: fields }))).toThrow();
});

it("rejects unknown template ids and collisions", () => {
  expect(() => planDocument(parseProjectConfig(), "missing", {})).toThrow();
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      templates: [
        {
          id: "duplicate",
          label: "Duplicate",
          path: "docs/{slug}.md",
          content: "",
          companions: [{ path: "docs/{slug}.md", content: "" }],
        },
      ],
    }),
  );
  expect(() => planDocument(config, "duplicate", { slug: "intro" })).toThrow();
});

it("rejects control characters and excessive paths", () => {
  for (const path of ["", "a".repeat(1001), "docs/\0x", "docs/\x7fx"])
    expect(() => safePath(path)).toThrow();
});

it("allows document files anywhere and limits code editing to declared files", () => {
  const config = parseProjectConfig();
  expect(isEditableFile(config, "sidebars.js")).toBe(true);
  expect(isEditableFile(config, "docs/_category_.json")).toBe(true);
  expect(isEditableFile(config, "src/App.tsx")).toBe(false);
  expect(isEditableFile(config, "other/a.md")).toBe(true);
  const template = {
    id: "t",
    label: "T",
    path: "docs/{slug}.md",
    content: "{missing}",
    companions: [],
  };
  expect(() => planDocument({ ...config, templates: [template] }, "t", { slug: "a" })).toThrow(
    "Не задано поле",
  );
});
