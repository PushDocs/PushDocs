import { expect, it } from "vitest";
import { articleRoute, previewPageUrl } from "./preview-page-url";

it.each([
  ["docs/intro.md", "", "", "/docs/intro"],
  ["docs/01-start/02-send.mdx", "", "routeBasePath: '/'", "/start/send"],
  ["docs/start/index.md", "", "baseUrl: '/help/'", "/help/docs/start"],
  ["docs/start/start.mdx", "", "", "/docs/start"],
  ["docs/start/README.md", "", "", "/docs/start"],
  ["docs/start/send.mdx", "---\nslug: /welcome\n---\n", "routeBasePath: '/'", "/welcome"],
  ["docs/start/send.mdx", "---\nslug: hello\n---\n", "", "/docs/start/hello"],
  [
    "i18n/en/docusaurus-plugin-content-docs/current/intro.md",
    "",
    "baseUrl: '/help/', routeBasePath: '/'",
    "/help/en/intro",
  ],
])("resolves the article route for %s", (path, source, config, expected) => {
  expect(articleRoute(path, source, config)).toBe(expected);
});
it("falls back to the site for dynamic configuration, unsupported paths and invalid slugs", () => {
  expect(articleRoute("docs/a.md", "", "routeBasePath: process.env.DOCS_ROUTE")).toBeUndefined();
  expect(articleRoute("src/a.ts", "", "")).toBeUndefined();
  expect(articleRoute("docs/a.md", "---\nslug: ../private\n---\n", "")).toBeUndefined();
});
it("preserves signed preview access when opening the article", () => {
  const signed = "https://build.preview.test/?token=secret&expires=123";
  const url = new URL(previewPageUrl(signed, "/docs/send"));
  expect(url.pathname).toBe("/docs/send");
  expect(url.search).toBe("?token=secret&expires=123");
  expect(previewPageUrl(signed)).toBe(signed);
});
