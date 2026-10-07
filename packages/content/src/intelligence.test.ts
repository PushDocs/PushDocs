import { describe, expect, it } from "vitest";
import {
  analyzeContent,
  type IndexedDocument,
  resolveDocument,
  searchDocuments,
} from "./intelligence";

const documents: [IndexedDocument, IndexedDocument] = [
  {
    path: "docs/a.md",
    title: "Integration",
    content: "---\nid: account\nslug: /account\n---\n# Account\nСаблогины и интеграции.",
    locale: "ru",
    version: "current",
  },
  {
    path: "docs/folder/b.mdx",
    title: "Other",
    content: "# Other",
    locale: "ru",
    version: "current",
  },
];
describe("document intelligence", () => {
  it("extracts reference links and text, excluding executable/code syntax", () => {
    const source =
      'import X from "pkg";\n\n# Hello\n\n[word][ref]\n\n![image](../pic.png)\n\n`badword`\n\n```js\nbadword\n```\n\n<X value="badword">Good text</X>\n\n[ref]: ../a.md#section';
    const result = analyzeContent(source);
    expect(result.links.map((l) => l.url)).toEqual(["../a.md#section", "../pic.png"]);
    expect(result.text.map((t) => t.value).join(" ")).toContain("Good text");
    expect(result.text.map((t) => t.value).join(" ")).not.toContain("badword");
    for (const text of result.text) expect(source.slice(text.start, text.end)).toBe(text.value);
  });
  it("resolves extensions, relative paths, fragments, ids and slugs", () => {
    for (const link of ["../a", "../a.md#hello", "/docs/a", "/docs/account", "/account"])
      expect(resolveDocument("docs/folder/b.mdx", link, documents)).toMatchObject({
        status: "resolved",
        path: "docs/a.md",
      });
    expect(resolveDocument("docs/a.md", "https://example.test/a", documents).status).toBe(
      "external",
    );
    expect(resolveDocument("docs/a.md", "missing", documents).status).toBe("unresolved");
    expect(
      resolveDocument("docs/folder/b.mdx", "/account", [
        ...documents,
        {
          path: "docs/duplicate.md",
          title: "Duplicate",
          content: documents[0]?.content ?? "",
          locale: "ru",
          version: "current",
        },
      ]),
    ).toMatchObject({ status: "ambiguous" });
  });
  it("finds current content by literal text and topic terms", () => {
    expect(searchDocuments(documents, "САБЛОГИНЫ")[0]?.path).toBe("docs/a.md");
    expect(searchDocuments(documents, "все статьи про интеграции", true)[0]?.path).toBe(
      "docs/a.md",
    );
    expect(searchDocuments(documents, "все статьи", true)).toEqual([]);
  });
  it("searches literal source even when another document cannot be parsed as MDX", () => {
    const broken = {
      ...documents[1],
      content: "# Other\n\n<!-- prettier-ignore -->\n\nUnrelated content.",
    };
    const matching = {
      ...documents[0],
      content: "---\ninvalid: [\n---\n\n```js\nconst provider = 'amoCRM';\n```",
    };
    const results = searchDocuments([broken, matching], "AMOcrm");
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ path: matching.path, line: 6 });
    expect(results[0]?.snippet).toContain("amoCRM");
    expect(searchDocuments([broken, matching], "missing")).toEqual([]);
  });
  it("falls back to Markdown text for topic search in unsupported MDX", () => {
    const broken = {
      ...documents[0],
      title: "Other",
      content:
        "# Other\n\n<!-- prettier-ignore -->\n\nИнтеграция с amoCRM.\n\n`hiddenword`\n\n```js\ncodeword\n```\n\n<!-- commentword -->",
    };
    expect(searchDocuments([broken, documents[1]], "найди статьи про amoCRM", true)).toEqual([
      expect.objectContaining({ path: broken.path, snippet: expect.stringContaining("amoCRM") }),
    ]);
    for (const query of ["hiddenword", "codeword", "commentword"])
      expect(searchDocuments([broken], query, true)).toEqual([]);
  });
});
