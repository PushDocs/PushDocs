import { parseProjectConfig } from "@pushdocs/content/config";
import { expect, it } from "vitest";
import sendsayExample from "../../../../docs/examples/sendsay-docs.pushdocs.json";
import type { MonacoApi } from "./monaco-runtime";
import { createPathIndex, pathCompletionItems } from "./path-completions";

const monaco = {
  languages: { CompletionItemKind: { Folder: 23, File: 20 } },
} as unknown as MonacoApi;
const paths = [
  "docs/guide/intro.mdx",
  "docs/guide/details.mdx",
  "docs/other.mdx",
  "docs/guide/images/example.png",
  "staticLocalized/ru/img/account-settings/labels/one.png",
  "staticLocalized/ru/img/account-settings/labels/two.png",
  "staticLocalized/ru/img/account-settings/how-to-enable-2fa/screen.png",
  "staticLocalized/ru/img/account-settings/readme.txt",
  "docs/guide/my images/a (1).png",
  "docs/guide/empty/.gitkeep",
];
const index = createPathIndex(paths);

function complete(
  source: string,
  documentPath = "docs/guide/intro.mdx",
  pathIndex = index,
  options: { locale?: string; defaultLocale?: string } = {},
) {
  const offset = source.indexOf("|");
  const before = source.slice(0, offset).split("\n");
  const lines = source.replace("|", "").split("\n");
  return pathCompletionItems(
    monaco,
    pathIndex,
    documentPath,
    lines[before.length - 1] ?? "",
    before.length,
    (before.at(-1)?.length ?? 0) + 1,
    {
      media: parseProjectConfig(JSON.stringify(sendsayExample)).media,
      ...options,
      getLineContent: (line) => lines[line - 1] ?? "",
    },
  );
}

it("shows the immediate children of the entered repository path, folders first", () => {
  const items = complete("![alt](/staticLocalized/ru/img/account-settings/|)");
  expect(items.map((item) => item.label)).toEqual(["how-to-enable-2fa/", "labels/", "readme.txt"]);
  expect(items[1]).toMatchObject({
    kind: 23,
    documentation: "staticLocalized/ru/img/account-settings/labels",
    insertText: "labels/",
    command: { id: "editor.action.triggerSuggest" },
  });
  expect(
    complete("![alt](/staticLocalized/ru/img/account-settings/labels/|)").map((i) => i.label),
  ).toEqual(["one.png", "two.png"]);
});

it("resolves relative paths from the current file, including parents and @site imports", () => {
  expect(complete("[link](|)").map((item) => item.label)).toEqual([
    "empty/",
    "images/",
    "my images/",
    "details.mdx",
    "intro.mdx",
  ]);
  expect(complete("[link](../ot|)").map((item) => item.label)).toEqual(["other.mdx"]);
  expect(
    complete('import image from "@site/staticLocalized/ru/img/account-settings/la|";')[0],
  ).toMatchObject({ label: "labels/", insertText: "labels/" });
  expect(complete("[link](../../../|)")).toEqual([]);
  expect(complete("[link](./|)", "readme.md").map((item) => item.label)).toEqual([
    "docs/",
    "staticLocalized/",
  ]);
});

it("replaces only the current segment and preserves the remainder, anchors and titles", () => {
  const source = '[link](./de|tails.mdx#part "Title")';
  const item = complete(source)[0];
  expect(item).toMatchObject({ label: "details.mdx", kind: 20, insertText: "details.mdx" });
  const line = source.replace("|", "");
  expect(item?.range).toEqual({
    startLineNumber: 1,
    endLineNumber: 1,
    startColumn: 10,
    endColumn: 21,
  });
  const range = item?.range as { startColumn: number; endColumn: number };
  expect(
    line.slice(0, range.startColumn - 1) + item?.insertText + line.slice(range.endColumn - 1),
  ).toBe('[link](./details.mdx#part "Title")');
  expect(complete("![alt](./im|ages/example.png)")[0]).toMatchObject({
    label: "images/",
    insertText: "images",
  });
});

it("supports Markdown definitions, angle destinations, JSX attributes and JSON strings", () => {
  for (const source of [
    "[link]: ./im|",
    "[link](<./im|>)",
    '<img src="./im|" />',
    "<Video src={'./im|'} />",
    '{"file": "./im|"}',
  ])
    expect(complete(source)[0]).toMatchObject({ label: "images/", insertText: "images/" });
});

it("encodes URL segments for Markdown and preserves literal file names in quoted paths", () => {
  expect(complete("![alt](./my%20images/|)")[0]).toMatchObject({
    label: "a (1).png",
    insertText: "a%20%281%29.png",
  });
  expect(complete('<img src="./my images/|" />')[0]).toMatchObject({
    label: "a (1).png",
    insertText: "a (1).png",
  });
});

it("does not offer repository paths outside local destinations or for invalid input", () => {
  for (const source of [
    "ordinary /im|",
    "[link](https://example.com/im|)",
    "[link](//example.com/im|)",
    "[link](mailto:user|)",
    "[link](#part|)",
    "[link](./intro.mdx#par|)",
    "[link](./intro.mdx?query=|)",
    "[link](./no-such-folder/|)",
    "[link](./%broken/|)",
    '[link](./intro.mdx "title|)',
    '<Tip title="Hello|" />',
    "[link](./intro.mdx)|",
  ])
    expect(complete(source), source).toEqual([]);
  expect(createPathIndex([]).size).toBe(0);
  expect(createPathIndex(["../secret", ".git/config", "/absolute", "docs//file"]).size).toBe(0);
  expect(complete("[link](./empty/|)")).toEqual([]);
});

it("resolves pathname URLs below static and keeps the scheme when replacing a segment", () => {
  const staticIndex = createPathIndex([
    "static/img/account-settings/labels/one.png",
    "static/downloads/guide.pdf",
    "static/img/account-settings/two.png",
    "docs/guide/other.png",
  ]);
  for (const source of [
    "![alt](pathname:///img/account-settings/|)",
    '<img src="pathname:///img/account-settings/|" />',
  ]) {
    const items = complete(source, undefined, staticIndex);
    expect(items.map((item) => item.label)).toEqual(["labels/", "two.png"]);
    const item = items[0];
    const range = item?.range as { startColumn: number; endColumn: number };
    const line = source.replace("|", "");
    expect(
      line.slice(0, range.startColumn - 1) + item?.insertText + line.slice(range.endColumn - 1),
    ).toBe(source.replace("|", "labels/"));
  }
  expect(complete("[file](pathname:///downloads/|)", undefined, staticIndex)[0]).toMatchObject({
    label: "guide.pdf",
    documentation: "static/downloads/guide.pdf",
  });
});

it("resolves an empty and relative DocMedia src below static/img, including multiline JSX", () => {
  const staticIndex = createPathIndex([
    "static/img/account-settings/labels/one.png",
    "static/img/top.png",
    "docs/account-settings/wrong.png",
  ]);
  expect(
    complete('<DocMedia src="|" />', undefined, staticIndex).map((item) => item.label),
  ).toEqual(["account-settings/", "top.png"]);
  for (const source of [
    '<DocMedia src="account-settings/|" alt="alt" />',
    "<DocMedia src={'account-settings/|'} />",
    '<DocMedia\n  alt="alt"\n  src="account-settings/|"\n/>',
    '<Other src="/unused" />\n<DocMedia\n  src="account-settings/|" />',
  ])
    expect(complete(source, undefined, staticIndex)[0]).toMatchObject({
      label: "labels/",
      documentation: "static/img/account-settings/labels",
      insertText: "labels/",
    });
  for (const source of [
    '<DocMedia alt="account-settings/|" />',
    '<Other src="account-settings/|" />',
    '<DocMedia />\n<Other src="account-settings/|" />',
    '<DocMedia src="https://example.test/|" />',
  ])
    expect(complete(source, undefined, staticIndex)).toEqual([]);
});

it("uses localized static directories with shared static files as fallback", () => {
  const localized = createPathIndex([
    "static/img/forms/shared.png",
    "static/img/forms/duplicate.png",
    "staticLocalized/ru/img/forms/ru.png",
    "staticLocalized/ru/img/forms/duplicate.png",
    "staticLocalized/en/img/forms/en.png",
    "staticLocalized/en/img/forms/duplicate.png",
  ]);
  for (const source of ['<DocMedia src="forms/|" />', "![alt](pathname:///en/img/forms/|)"]) {
    const items = complete(source, "i18n/en/docs/guide.mdx", localized);
    expect(items.map((item) => item.label)).toEqual(["duplicate.png", "en.png", "shared.png"]);
    expect(items[0]?.documentation).toBe("staticLocalized/en/img/forms/duplicate.png");
  }
  expect(
    complete('<DocMedia src="../en/img/forms/|" />', undefined, localized).map((i) => i.label),
  ).toEqual(["duplicate.png", "en.png", "shared.png"]);
  expect(
    complete('<DocMedia src="../../img/forms/|" />', "i18n/en/docs/guide.mdx", localized).map(
      (i) => i.label,
    ),
  ).toEqual(["duplicate.png", "ru.png", "shared.png"]);
  expect(
    complete('<DocMedia src="forms/|" />', undefined, localized, { locale: "en" }).map(
      (i) => i.label,
    ),
  ).toEqual(["duplicate.png", "en.png", "shared.png"]);
  const shared = createPathIndex([
    "static/img/forms/shared.png",
    "staticLocalized/img/forms/default.png",
  ]);
  expect(complete('<DocMedia src="forms/|" />', undefined, shared).map((i) => i.label)).toEqual([
    "shared.png",
  ]);
  expect(
    complete('<DocMedia src="forms/|" />', "i18n/en/docs/guide.mdx", shared).map((i) => i.label),
  ).toEqual(["shared.png"]);
});

it("keeps public URL encoding and does not traverse above static directories", () => {
  const staticIndex = createPathIndex(["static/img/my images/a (1).png", "secret.png"]);
  for (const source of [
    '<DocMedia src="my%20images/a%20|" />',
    "![alt](pathname:///img/my%20images/a%20|)",
    '<img src="pathname:///img/my%20images/a%20|" />',
  ])
    expect(complete(source, undefined, staticIndex)[0]).toMatchObject({
      label: "a (1).png",
      insertText: "a%20%281%29.png",
    });
  for (const source of [
    '<DocMedia src="../../|" />',
    "![alt](pathname:///../|)",
    "![alt](pathname:///img/my%broken/|)",
    "![alt](pathname://example.test/img/|)",
  ])
    expect(complete(source, undefined, staticIndex)).toEqual([]);
});

it("completes Video src from its configured video source, including multiline JSX and public URLs", () => {
  const videos = createPathIndex([
    "staticLocalized/ru/video/forms/clips/demo.MP4",
    "staticLocalized/ru/video/forms/a file.mp4",
    "staticLocalized/ru/video/forms/poster.png",
    "static/video/forms/shared.mp4",
  ]);
  expect(complete('<Video src="|" />', undefined, videos)[0]).toMatchObject({
    label: "forms/",
    insertText: "/video/forms/",
    command: { id: "editor.action.triggerSuggest" },
  });
  for (const source of [
    '<Video src="/video/forms/|" />',
    "<Video src={'/video/forms/|'} />",
    '<Video\n  muted="false"\n  src="/video/forms/|"\n/>',
    '<Other src="/unused" />\n<Video\n  src="/video/forms/|" />',
  ]) {
    const items = complete(source, undefined, videos);
    expect(items.map((item) => item.label)).toEqual(["clips/", "a file.mp4", "shared.mp4"]);
    expect(items[1]?.insertText).toBe("a%20file.mp4");
  }
  expect(complete('<Video poster="forms/|" />', undefined, videos)).toEqual([]);
  expect(complete('<Video src="https://example.test/|" />', undefined, videos)).toEqual([]);
  expect(complete('<Video src="//example.test/|" />', undefined, videos)).toEqual([]);
});

it("uses localized and custom Video directories rather than assuming a video folder name", () => {
  const videos = createPathIndex([
    "staticLocalized/en/video/forms/en.mp4",
    "staticLocalized/ru/video/forms/ru.mp4",
    "static/video/forms/shared.mp4",
    "static/video/forms/en.mp4",
  ]);
  expect(complete('<Video src="|" />', "i18n/en/docs/guide.mdx", videos)[0]).toMatchObject({
    label: "forms/",
    insertText: "/en/video/forms/",
  });
  const items = complete('<Video src="/en/video/forms/|" />', "i18n/en/docs/guide.mdx", videos);
  expect(items.map((item) => item.label)).toEqual(["en.mp4", "shared.mp4"]);
  expect(items[0]?.documentation).toBe("staticLocalized/en/video/forms/en.mp4");
  const media = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        video: { directory: "assets/{locale}/movies", publicUrl: "/manual/{locale}/clips" },
        components: { Video: { storage: "video" } },
      },
    }),
  ).media;
  expect(
    pathCompletionItems(
      monaco,
      createPathIndex(["assets/en/movies/demo.mp4"]),
      "i18n/en/docs/guide.mdx",
      '<Video src="" />',
      1,
      13,
      { media },
    )[0],
  ).toMatchObject({
    label: "demo.mp4",
    insertText: "/manual/en/clips/demo.mp4",
  });
});

it("resolves configured component names against a source base separate from storage", () => {
  const media = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "static/pictures", publicUrl: "/pictures" },
        components: { Illustration: { storage: "images", srcBase: "/img" } },
      },
    }),
  ).media;
  const line = '<Illustration src="../pictures/" />';
  expect(
    pathCompletionItems(
      monaco,
      createPathIndex(["static/pictures/logo.png"]),
      "docs/a.mdx",
      line,
      1,
      line.indexOf('/"') + 2,
      { media },
    )[0],
  ).toMatchObject({ label: "logo.png", documentation: "static/pictures/logo.png" });
  expect(
    pathCompletionItems(monaco, index, "docs/a.mdx", '<DocMedia src="" />', 1, 16, {
      media: parseProjectConfig().media,
    }),
  ).toEqual([]);
});
