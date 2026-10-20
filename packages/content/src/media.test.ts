import { expect, it } from "vitest";
import sendsayExample from "../../../docs/examples/sendsay-docs.pushdocs.json";
import { parseProjectConfig } from "./config";

const exampleConfig = () => parseProjectConfig(JSON.stringify(sendsayExample));

import {
  attachmentSnippet,
  groupMediaAssets,
  markdownAttachmentSnippet,
  mediaCatalog,
  mediaDisplayPath,
} from "./media";

it("provides insertable links beyond the upload directory, including localized media", () => {
  const result = mediaCatalog({
    config: parseProjectConfig(
      JSON.stringify({
        version: 1,
        media: {
          images: { directory: "staticLocalized/{locale}/img" },
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
        url: "/img/ecom/a.png",
        canDelete: true,
      }),
      expect.objectContaining({
        path: "staticLocalized/ru/img/forms/filter.gif",
        url: "/img/forms/filter.gif",
        canDelete: true,
      }),
      expect.objectContaining({
        path: "static/favicon.svg",
        url: "/favicon.svg",
        canDelete: true,
      }),
      expect.objectContaining({
        path: "other/архив с данными.zip",
        url: "../../other/%D0%B0%D1%80%D1%85%D0%B8%D0%B2%20%D1%81%20%D0%B4%D0%B0%D0%BD%D0%BD%D1%8B%D0%BC%D0%B8.zip",
        canDelete: true,
      }),
    ]),
  );
});

it.each(["assets/ru/pictures", "assets/en/pictures"])(
  "groups Russian, English and fallback files from the configured directory %s",
  (directory) => {
    const paths = [
      "static/img/logo.svg",
      "assets/en/pictures/forms/en.png",
      "other/file.zip",
      "assets/ru/pictures/other/a.png",
      "assets/ru/pictures-other/common.png",
      "assets/ru/pictures/forms/a.png",
      "staticLocalized/ru/img/old.png",
    ];
    const groups = groupMediaAssets(
      paths.map((path) => ({ path })),
      [directory.replace("/en/", "/ru/"), directory.replace("/ru/", "/en/"), "static/img"],
    );
    expect(groups.map((group) => group.label)).toEqual([
      "Файлы · assets/ru/pictures",
      "Файлы · assets/en/pictures",
      "Файлы · static/img",
      "Другие файлы проекта",
    ]);
    expect(groups[0]?.assets.map((asset) => asset.path)).toEqual([paths[3], paths[5]]);
    expect(groups[1]?.assets.map((asset) => asset.path)).toEqual([paths[1]]);
    expect(groups[3]?.assets.map((asset) => asset.path)).toEqual([paths[2], paths[4], paths[6]]);
    expect(groups.flatMap((group) => group.assets)).toHaveLength(paths.length);
    expect(mediaDisplayPath(paths[1] ?? "", groups[1]?.directory)).toBe("forms/en.png");
    expect(mediaDisplayPath(paths[3] ?? "", groups[0]?.directory)).toBe("other/a.png");
    expect(mediaDisplayPath(paths[0] ?? "", groups[2]?.directory)).toBe("logo.svg");
    expect(mediaDisplayPath("assets/ru/pictures-other/common.png", groups[0]?.directory)).toBe(
      "assets/ru/pictures-other/common.png",
    );
  },
);

it("shows a shared configured directory without inventing locale folders or duplicating static/img", () => {
  const paths = ["static/img/a.png", "assets/pictures/a.png", "static/logo.svg"];
  const assets = paths.map((path) => ({ path }));
  expect(groupMediaAssets(assets).map((group) => group.label)).toEqual(["Другие файлы проекта"]);
  const groups = groupMediaAssets(assets, ["assets/pictures", "static/img"]);
  expect(groups.map((group) => group.label)).toEqual([
    "Файлы · assets/pictures",
    "Файлы · static/img",
    "Другие файлы проекта",
  ]);
  expect(groups.flatMap((group) => group.assets)).toHaveLength(paths.length);
});

it("keeps fallback files separate when the configured directory contains static/img", () => {
  const groups = groupMediaAssets(
    [{ path: "static/img/a.png" }, { path: "static/logo.svg" }],
    ["static", "static/img"],
  );
  expect(groups.map((group) => [group.directory, group.assets.map((asset) => asset.path)])).toEqual(
    [
      ["static", ["static/logo.svg"]],
      ["static/img", ["static/img/a.png"]],
    ],
  );
});

it.each([
  ["staticLocalized/ru/img/forms/a.png", "ru", "forms/a.png"],
  ["staticLocalized/en/img/forms/demo.mp4", "en", "forms/demo.mp4"],
  ["static/img/forms/a.png", "en", "forms/a.png"],
  ["static/favicon.svg", "ru", "../favicon.svg"],
  ["staticLocalized/en/img/forms/a.png", "ru", "../en/img/forms/a.png"],
  ["staticLocalized/ru/img/forms/a.png", "en", "../../img/forms/a.png"],
])("inserts a DocMedia source for %s in %s", (path, locale, src) => {
  expect(attachmentSnippet({ path, url: "/unused" }, exampleConfig(), locale, "DocMedia")).toBe(
    `<DocMedia src="${src}" alt="${path.split("/").at(-1)}" />`,
  );
});

it("escapes filenames in DocMedia attributes", () => {
  expect(
    attachmentSnippet(
      { path: 'static/img/a"&<>.png', url: "/unused" },
      exampleConfig(),
      "ru",
      "DocMedia",
    ),
  ).toBe('<DocMedia src="a%22%26%3C%3E.png" alt="a&quot;&amp;&lt;&gt;.png" />');
});

it("preserves encoded filenames from a custom public media mapping", () => {
  const name = "снимок экрана.png";
  expect(
    attachmentSnippet(
      { path: `assets/forms/${name}`, url: `/img/forms/${encodeURIComponent(name)}` },
      exampleConfig(),
      "ru",
      "DocMedia",
    ),
  ).toBe(`<DocMedia src="forms/${encodeURIComponent(name)}" alt="${name}" />`);
});

it("inserts generic attachments as Markdown images or links without DocMedia", () => {
  expect(markdownAttachmentSnippet({ path: "static/img/a.png", url: "/img/a.png" })).toBe(
    "![a.png](pathname:///img/a.png)",
  );
  expect(markdownAttachmentSnippet({ path: "docs/files/guide.pdf", url: "files/guide.pdf" })).toBe(
    "[guide.pdf](files/guide.pdf)",
  );
});

it("inserts Video with a public URL and escapes JSX attributes", () => {
  expect(
    attachmentSnippet(
      { path: "unmapped/a.mp4", url: "pathname:///en/video/forms/a%20file.mp4" },
      exampleConfig(),
      "en",
      "Video",
    ),
  ).toBe('<Video src="/en/video/forms/a%20file.mp4" />');
  expect(
    attachmentSnippet(
      { path: "unmapped/a.mp4", url: '/video/a.mp4?title="A"&size=<1>' },
      exampleConfig(),
      "ru",
      "Video",
    ),
  ).toBe('<Video src="/video/a.mp4?title=&quot;A&quot;&amp;size=&lt;1&gt;" />');
});

it("combines repository media and uploads with branch-local deletions and possible usages", () => {
  const result = mediaCatalog({
    config: exampleConfig(),
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
      canDelete: true,
      inRepository: true,
      status: "clean",
      size: null,
      usages: [],
    },
    {
      path: "static/img/gone.gif",
      url: "/img/gone.gif",
      canDelete: true,
      inRepository: true,
      status: "delete",
      size: null,
      usages: [],
    },
    {
      path: "static/img/new.png",
      url: "/img/new.png",
      canDelete: true,
      inRepository: false,
      status: "upload",
      size: 100,
      usages: [],
    },
    {
      path: "static/img/old.png",
      url: "/img/old.png",
      canDelete: true,
      inRepository: true,
      status: "upload",
      size: 50,
      usages: ["docs/intro.md"],
    },
  ]);
});

it("matches DocMedia usages by the resolved path rather than a shared filename", () => {
  const document = "docs/account-settings/documentary-archive.mdx";
  const used = "staticLocalized/ru/img/account-settings/documentary-archive/settings.png";
  const paths = [
    used,
    "staticLocalized/ru/img/email-campaigns/settings.png",
    "staticLocalized/en/img/account-settings/documentary-archive/settings.png",
    "static/img/account-settings/documentary-archive/settings.png",
  ];
  const catalog = mediaCatalog({
    config: exampleConfig(),
    locale: "ru",
    document,
    paths,
    uploads: [],
    files: [
      {
        path: document,
        status: "clean",
        content:
          '<DocMedia\n src="account-settings/documentary-archive/settings.png"\n alt="settings.png"\n/>',
      },
    ],
  });
  expect(
    catalog.filter((asset) => asset.usages.includes(document)).map((asset) => asset.path),
  ).toEqual([used]);
});

it("resolves Markdown links, references and JSX attributes to exact repository paths", () => {
  const document = "docs/forms/article.mdx";
  const paths = [
    "staticLocalized/ru/img/forms/settings.png",
    "staticLocalized/ru/img/other/settings.png",
    "staticLocalized/ru/img/forms/снимок экрана.png",
    "docs/forms/local.png",
    "docs/other/local.png",
    "static/files/guide.pdf",
    "static/img/unused.png",
  ];
  const catalog = mediaCatalog({
    config: exampleConfig(),
    locale: "ru",
    document,
    paths,
    uploads: [],
    files: [
      {
        path: document,
        status: "clean",
        content: [
          "![Settings](pathname:///img/forms/settings.png?raw=1#preview)",
          "![Screen](/img/forms/%D1%81%D0%BD%D0%B8%D0%BC%D0%BE%D0%BA%20%D1%8D%D0%BA%D1%80%D0%B0%D0%BD%D0%B0.png)",
          "![Local][ref]",
          "[ref]: ./local.png",
          "[unused]: /img/unused.png",
          '<a href="/files/guide.pdf">Guide</a>',
          '<img src={"/img/forms/settings.png"} />',
        ].join("\n\n"),
      },
    ],
  });
  expect(
    catalog.filter((asset) => asset.usages.includes(document)).map((asset) => asset.path),
  ).toEqual([paths[3], paths[5], paths[0], paths[2]]);
});

it("ignores names in prose, alt text, code, comments, external links and dynamic expressions", () => {
  const document = "docs/forms/article.mdx";
  const paths = ["static/img/forms/used.png", "static/img/forms/settings.png"];
  const catalog = mediaCatalog({
    config: exampleConfig(),
    locale: "ru",
    document,
    paths,
    uploads: [],
    files: [
      {
        path: document,
        status: "clean",
        content: [
          "forms/settings.png",
          '<DocMedia src="forms/used.png" alt="forms/settings.png" />',
          '`<DocMedia src="forms/settings.png" />`',
          '```mdx\n<DocMedia src="forms/settings.png" />\n```',
          '{/* <DocMedia src="forms/settings.png" /> */}',
          '<DocMedia src={(() => { throw new Error("must not execute"); })()} />',
          "![External](https://example.test/img/forms/settings.png)",
        ].join("\n\n"),
      },
    ],
  });
  expect(catalog.find((asset) => asset.path === paths[0])?.usages).toEqual([document]);
  expect(catalog.find((asset) => asset.path === paths[1])?.usages).toEqual([]);
});

it("resolves usage in each article's own locale and excludes deleted articles", () => {
  const ru = "docs/forms/article.mdx";
  const en = "i18n/en/docusaurus-plugin-content-docs/current/forms/article.mdx";
  const paths = [
    "staticLocalized/ru/img/forms/settings.png",
    "staticLocalized/en/img/forms/settings.png",
  ];
  const content = '<DocMedia src="forms/settings.png" alt="Settings" />';
  const catalog = mediaCatalog({
    config: exampleConfig(),
    locale: "en",
    document: en,
    paths,
    uploads: [],
    files: [
      { path: ru, locale: "default", status: "clean", content },
      { path: en, locale: "en", status: "modify", content },
      { path: "docs/deleted.mdx", status: "delete", content },
    ],
  });
  expect(catalog.find((asset) => asset.path === paths[0])?.usages).toEqual([ru]);
  expect(catalog.find((asset) => asset.path === paths[1])?.usages).toEqual([en]);
});

it("retains exact static references in imported Markdown containing HTML comments", () => {
  const document = "docs/forms/article.md";
  const catalog = mediaCatalog({
    config: exampleConfig(),
    locale: "ru",
    document,
    paths: ["static/img/forms/settings.png", "static/img/other/settings.png"],
    uploads: [],
    files: [
      {
        path: document,
        status: "clean",
        content:
          '<!-- <DocMedia src="other/settings.png" /> -->\n\n<DocMedia src="forms/settings.png" />',
      },
    ],
  });
  expect(catalog.find((asset) => asset.path === "static/img/forms/settings.png")?.usages).toEqual([
    document,
  ]);
  expect(catalog.find((asset) => asset.path === "static/img/other/settings.png")?.usages).toEqual(
    [],
  );
});

it("tracks newly uploaded and cross-locale media and refreshes usages after an edit", () => {
  const document = "docs/forms/article.mdx";
  const path = "staticLocalized/en/img/forms/settings.png";
  const input = {
    config: exampleConfig(),
    locale: "ru",
    document,
    paths: ["staticLocalized/ru/img/forms/settings.png"],
    uploads: [{ path, size: 20 }],
    files: [
      {
        path: document,
        status: "modify",
        content: '<DocMedia src={"../en/img/forms/settings.png"} />',
      },
    ],
  };
  expect(mediaCatalog(input).find((asset) => asset.path === path)?.usages).toEqual([document]);
  input.files = [{ path: document, status: "modify", content: "settings.png" }];
  expect(mediaCatalog(input).find((asset) => asset.path === path)?.usages).toEqual([]);
});

it("resolves configured public roots and explicit repository paths without basename fallback", () => {
  const document = "i18n/en/docusaurus-plugin-content-docs/current/forms/article.mdx";
  const paths = ["assets/en/forms/settings.png", "assets/en/other/settings.png"];
  const catalog = mediaCatalog({
    config: parseProjectConfig(
      JSON.stringify({
        version: 1,
        media: {
          images: { directory: "assets/{locale}", publicUrl: "/{locale}/media" },
        },
      }),
    ),
    locale: "en",
    document,
    paths,
    uploads: [],
    files: [
      {
        path: document,
        status: "clean",
        content:
          '![Settings](/en/media/forms/settings.png)\n\n<img src="@site/assets/en/forms/settings.png" />',
      },
    ],
  });
  expect(catalog.find((asset) => asset.path === paths[0])?.usages).toEqual([document]);
  expect(catalog.find((asset) => asset.path === paths[1])?.usages).toEqual([]);
});
