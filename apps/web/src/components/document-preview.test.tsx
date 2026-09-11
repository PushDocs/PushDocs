// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DocumentPreview } from "./document-preview";
import { previewAssetUrl } from "./preview-markdown";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
const context = {
  projectId: "p",
  branch: "docs/new",
  path: "docs/account/article.mdx",
  repositoryPaths: ["static/img/archive.png", "docs/account/local.png", "docs/shared.png"],
};
function preview(source: string) {
  return <DocumentPreview {...context} source={source} />;
}

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
      previewAssetUrl("pathname:///img/archive.png", { ...context, repositoryPaths, locale }),
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
        directory: "staticLocalized/{locale}/img/{documentDir}",
        publicUrl: "pathname:///img/{documentDir}",
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
