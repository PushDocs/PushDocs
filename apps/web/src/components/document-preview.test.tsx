// @vitest-environment jsdom
import { parseProjectConfig } from "@pushdocs/content/config";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import sendsayExample from "../../../../docs/examples/sendsay-docs.pushdocs.json";
import { DocumentPreview } from "./document-preview";
import { previewAssetUrl } from "./preview-markdown";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const context = {
  media: parseProjectConfig(JSON.stringify(sendsayExample)).media,
  projectId: "p",
  branch: "docs/new",
  path: "docs/account/article.mdx",
  repositoryPaths: [
    "static/img/archive.png",
    "static/img/folder/demo.mp4",
    "docs/account/local.png",
    "docs/shared.png",
  ],
};
function preview(source: string) {
  return <DocumentPreview {...context} source={source} />;
}

it("previews DocMedia images and MP4 using paths relative to static/img", () => {
  const { container } = render(
    preview(
      '<DocMedia src="archive.png" alt="Архив" width="70%" />\n\n<DocMedia src="folder/demo.mp4" alt="Демонстрация" title="Видео" />',
    ),
  );
  const image = screen.getByRole("img", { name: "Архив" });
  expect(image.getAttribute("src")).toContain("path=static%2Fimg%2Farchive.png");
  expect(image.getAttribute("width")).toBe("70%");
  const video = container.querySelector("video");
  expect(video?.getAttribute("src")).toContain("path=static%2Fimg%2Ffolder%2Fdemo.mp4");
  expect(video?.getAttribute("aria-label")).toBe("Демонстрация");
  expect(video?.hasAttribute("controls")).toBe(true);
});

it.each([
  ["ru", "../en/img/forms/image.png", "staticLocalized/en/img/forms/image.png"],
  ["en", "../../img/forms/image.png", "staticLocalized/ru/img/forms/image.png"],
  ["en", "forms/image.png", "staticLocalized/en/img/forms/image.png"],
])("previews a selected localized DocMedia from %s", (locale, src, assetPath) => {
  render(
    <DocumentPreview
      {...context}
      locale={locale}
      defaultLocale="ru"
      repositoryPaths={[
        "staticLocalized/ru/img/forms/image.png",
        "staticLocalized/en/img/forms/image.png",
      ]}
      media={context.media}
      source={`<DocMedia src="${src}" alt="Selected" />`}
    />,
  );
  expect(screen.getByRole("img", { name: "Selected" }).getAttribute("src")).toContain(
    `path=${encodeURIComponent(assetPath)}`,
  );
});

it.each([
  ["ru", "/video/forms/demo.mp4", "staticLocalized/ru/video/forms/demo.mp4"],
  ["en", "/en/video/forms/demo.mp4", "staticLocalized/en/video/forms/demo.mp4"],
])("previews the selected localized Video in %s", (locale, src, path) => {
  const { container } = render(
    <DocumentPreview
      {...context}
      locale={locale}
      repositoryPaths={[path]}
      source={`<Video src="${src}" />`}
    />,
  );
  expect(container.querySelector("video")?.getAttribute("src")).toContain(
    `path=${encodeURIComponent(path)}`,
  );
});

it("opens document links in a new tab", () => {
  render(preview("[Внешняя](https://example.test) и [внутренняя](/docs/guide)"));
  for (const name of ["Внешняя", "внутренняя"]) {
    const link = screen.getByRole("link", { name });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  }
});

it("renders the Sendsay draft pattern including text immediately before the import", () => {
  render(
    preview(
      "---\ntitle: Hidden metadata\n---\n\nыфывф\nimport SupportLink from '@site/src/components/SupportLink';\n\n# Архив\n\n:::tip Важно\n<SupportLink>Чат поддержки</SupportLink>\n:::\n\n![Архив](pathname:///img/archive.png)",
    ),
  );
  expect(screen.getByRole("article").textContent).toContain("ыфывф");
  expect(screen.getByRole("article").textContent).not.toMatch(
    /import|Hidden metadata|:::|<SupportLink>/,
  );
  expect(screen.getByRole("note").textContent).toBe("ВажноЧат поддержки");
  expect(screen.getByRole("img").getAttribute("src")).toBe(
    "/api/projects/p/assets?branch=docs%2Fnew&path=static%2Fimg%2Farchive.png",
  );
});

it("preserves code examples and handles multiline imports and native JSX", () => {
  render(
    preview(
      "import {\n  something\n} from 'module';\n\n```mdx\nimport Example from 'example';\n:::tip Example\n<Component />\n```\n\n<details><summary>Подробнее</summary>Текст</details>\n\n<img src=\"./local.png\" alt=\"Локальная\" />",
    ),
  );
  const code = screen.getByRole("article").querySelector("pre");
  expect(code?.textContent).toContain(":::tip Example");
  expect(code?.textContent).toContain("import Example");
  expect(screen.getByRole("article").textContent).not.toContain("something");
  expect(screen.getByText("Подробнее").tagName).toBe("SUMMARY");
  expect(screen.getByRole("img").getAttribute("src")).toContain("docs%2Faccount%2Flocal.png");
});

it("does not execute embedded code or forward script tags and event handlers", () => {
  const { container } = render(
    preview(
      "export const run = (() => { throw new Error('executed') })();\n\n<script>bad()</script>\n\n<img src=\"/img/archive.png\" onError={() => alert('x')} />\n\n<a href=\"javascript:alert(1)\">Ссылка</a>\n\n{1 + 2}\n\n<Unknown />",
    ),
  );
  expect(container.querySelector("script")).toBeNull();
  expect(container.querySelector("img")?.getAttribute("onerror")).toBeNull();
  expect(container.querySelector("a")?.getAttribute("href")).not.toContain("javascript:");
  expect(screen.getByText("{1 + 2}")).toBeTruthy();
  expect(
    screen
      .getByText(/Unknown · Упрощённое превью/)
      .closest(".wb-preview-component")
      ?.getAttribute("title"),
  ).toContain("Компонент Unknown");
});

it("recovers from incomplete MDX when the source is corrected", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { rerender } = render(preview("<Unclosed>"));
  expect(screen.getByRole("alert")).toBeTruthy();
  rerender(preview("# Исправлено"));
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("heading", { name: "Исправлено" })).toBeTruthy();
});
it("maps a syntax error back to the source line after front matter and import normalization", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const jump = vi.fn();
  render(
    <DocumentPreview
      {...context}
      onErrorLine={jump}
      source={"---\ntitle: Example\n---\nimport Widget from 'widget';\n\n{broken)}"}
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("строка 6");
  fireEvent.click(screen.getByRole("button", { name: "Перейти к ошибке" }));
  expect(jump).toHaveBeenCalledWith(6);
});
it("marks approximate custom components even when they contain visible children", () => {
  render(preview("<Custom>Visible child</Custom>"));
  expect(screen.getByRole("article").textContent).toContain("Custom · Упрощённое превью");
  expect(screen.getByRole("article").textContent).toContain("Visible child");
});

it.each([
  ["../shared.png", "docs%2Fshared.png"],
  ["@site/static/img/archive.png", "static%2Fimg%2Farchive.png"],
  ["pathname:///img/archive.png", "static%2Fimg%2Farchive.png"],
  ["./local.png", "docs%2Faccount%2Flocal.png"],
])("resolves repository asset %s", (input, path) => {
  expect(previewAssetUrl(input, context)).toContain(`path=${path}`);
});
it("rejects unsafe asset URLs and keeps external images intact", () => {
  expect(previewAssetUrl("javascript:alert(1)", context)).toBe("");
  expect(previewAssetUrl("../../../../secret.png", context)).toBe("");
  expect(previewAssetUrl("https://example.com/image.png", context)).toBe(
    "https://example.com/image.png",
  );
});

it("selects localized static assets for the document language", () => {
  const repositoryPaths = [
    "staticLocalized/en/img/archive.png",
    "staticLocalized/ru/img/archive.png",
  ];
  for (const locale of ["ru", "en"]) {
    expect(
      previewAssetUrl(`pathname:///${locale === "ru" ? "" : "en/"}img/archive.png`, {
        ...context,
        repositoryPaths,
        locale,
      }),
    ).toContain(`path=staticLocalized%2F${locale}%2Fimg%2Farchive.png`);
  }
});

it("resolves newly uploaded assets from the configured media mapping", () => {
  expect(
    previewAssetUrl("pathname:///img/account/new.png", {
      ...context,
      locale: "ru",
      repositoryPaths: [],
      media: {
        components: {},
        images: { directory: "staticLocalized/{locale}/img", publicUrl: "/{locale}/img" },
      },
    }),
  ).toContain("path=staticLocalized%2Fru%2Fimg%2Faccount%2Fnew.png");
});

it("renders component examples as collapsible content, tabs and video", () => {
  const { container } = render(
    preview(
      '<Details summary="Подробнее">\n\nТекст пояснения\n\n</Details>\n\n<Tabs>\n<TabItem value="a" label="Первый">Первый вариант</TabItem>\n<TabItem value="b" label="Второй">Второй вариант</TabItem>\n</Tabs>\n\n<Video src="https://example.test/video.mp4" />',
    ),
  );
  expect(screen.getByText("Подробнее").tagName).toBe("SUMMARY");
  expect(screen.getByRole("tabpanel").textContent).toBe("Первый вариант");
  fireEvent.click(screen.getByRole("tab", { name: "Второй" }));
  expect(screen.getByRole("tabpanel").textContent).toBe("Второй вариант");
  expect(container.querySelector("video")?.getAttribute("src")).toBe(
    "https://example.test/video.mp4",
  );
  expect(container.querySelector("video")?.hasAttribute("controls")).toBe(true);
});

it("falls back for a Tabs wrapper without tab items and uses an explicit site preview", () => {
  const view = render(preview("<Tabs>Plain child</Tabs>"));
  expect(screen.getByText("Plain child")).toBeTruthy();
  expect(screen.queryByRole("tablist")).toBeNull();
  view.rerender(
    <DocumentPreview
      {...context}
      source="<Custom />"
      sitePreviewUrl="https://preview.example.test/docs/a"
    />,
  );
  const link = screen.getByRole("link", { name: "Открыть предпросмотр сайта" });
  expect(link.getAttribute("href")).toBe("https://preview.example.test/docs/a");
  expect(link.getAttribute("target")).toBe("_blank");
});

it("supports keyboard navigation across preview tabs", () => {
  render(
    preview(
      '<Tabs>\n<TabItem value="a" label="First">One</TabItem>\n<TabItem value="b" label="Second">Two</TabItem>\n</Tabs>',
    ),
  );
  const first = screen.getByRole("tab", { name: "First" });
  fireEvent.keyDown(first, { key: "ArrowRight" });
  expect(screen.getByRole("tabpanel").textContent).toBe("Two");
  expect(document.activeElement).toBe(screen.getByRole("tab", { name: "Second" }));
  fireEvent.keyDown(screen.getByRole("tab", { name: "Second" }), { key: "ArrowLeft" });
  fireEvent.keyDown(first, { key: "End" });
  fireEvent.keyDown(screen.getByRole("tab", { name: "Second" }), { key: "Home" });
  fireEvent.keyDown(first, { key: "Escape" });
  expect(screen.getByRole("tabpanel").textContent).toBe("One");
});

it("provides a branch-specific route to the real preview for unsupported components", () => {
  render(preview("<Custom />"));
  expect(
    screen.getByRole("link", { name: "Открыть MR / PR для предпросмотра" }).getAttribute("href"),
  ).toBe("/projects/p/reviews?branch=docs%2Fnew");
});

it("also provides preview navigation for an unsupported inline component", () => {
  render(preview("Text with <Custom>inline content</Custom>."));
  expect(screen.getByRole("link", { name: "Открыть MR / PR для предпросмотра" })).toBeTruthy();
  expect(screen.getByText(/inline content/)).toBeTruthy();
});

it("uses an explicitly configured component base independently of its storage URL", () => {
  const media = parseProjectConfig(
    JSON.stringify({
      version: 1,
      media: {
        images: { directory: "static/pictures", publicUrl: "/pictures" },
        components: { Illustration: { storage: "images", srcBase: "/img" } },
      },
    }),
  ).media;
  render(
    <DocumentPreview
      {...context}
      media={media}
      repositoryPaths={["static/pictures/logo.png"]}
      source='<Illustration src="../pictures/logo.png" alt="Logo" />'
    />,
  );
  expect(screen.getByRole("img", { name: "Logo" }).getAttribute("src")).toContain(
    "path=static%2Fpictures%2Flogo.png",
  );
});

it("does not infer media semantics from a component name without integration", () => {
  const { container } = render(
    <DocumentPreview
      {...context}
      media={parseProjectConfig().media}
      source='<DocMedia src="archive.png" />\n\n<Video src="/video/clip.mp4" />'
    />,
  );
  expect(container.querySelector("img, video")).toBeNull();
  expect(container.textContent).toContain("DocMedia");
});
