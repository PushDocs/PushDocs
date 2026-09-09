import { expect, it } from "vitest";
import {
  assetLocation,
  isEditableFile,
  parseProjectConfig,
  planDocument,
  planTemplate,
  safePath,
} from "./config";

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
  expect(assetLocation(parseProjectConfig(), "ru", "docs/intro.md", "hello.png")).toEqual({
    path: "static/img/hello.png",
    url: "/img/hello.png",
  });
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

it("resolves localized media paths separately from public links", () => {
  const config = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        directory: "staticLocalized/{locale}/img/{documentDir}",
        publicUrl: "pathname:///img/{documentDir}",
      },
    }),
  );
  expect(assetLocation(config, "ru", "docs/forms/survey.mdx", "guide.gif")).toEqual({
    path: "staticLocalized/ru/img/forms/guide.gif",
    url: "pathname:///img/forms/guide.gif",
  });
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

it("rejects control characters, excessive paths and unsafe media destinations", () => {
  for (const path of ["", "a".repeat(1001), "docs/\0x", "docs/\x7fx"])
    expect(() => safePath(path)).toThrow();
  for (const [locale, name] of [
    ["../en", "a.png"],
    ["en", ""],
    ["en", "a/b"],
    ["en", "a\\b"],
  ])
    expect(() =>
      assetLocation(parseProjectConfig(), locale ?? "", "docs/a.md", name ?? ""),
    ).toThrow();
  for (const publicUrl of ["//evil.test", "https://evil.test", "relative"])
    expect(() =>
      assetLocation(
        { ...parseProjectConfig(), media: { directory: "static/img", publicUrl } },
        "en",
        "docs/a.md",
        "a.png",
      ),
    ).toThrow();
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
