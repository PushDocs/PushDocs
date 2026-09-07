import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { analyzeDocusaurusFiles, discoverDocusaurusProject } from "./index";

let directory: string | undefined;

afterEach(async () => {
  if (directory) await rm(directory, { force: true, recursive: true });
  directory = undefined;
});

describe("Docusaurus file analysis", () => {
  it("discovers current, versioned, and translated documents", () => {
    const profile = analyzeDocusaurusFiles(
      new Map([
        ["docs/intro.md", "# Intro"],
        ["versioned_docs/version-2.1/guide.mdx", "# Versioned"],
        ["i18n/ru/docusaurus-plugin-content-docs/current/intro.md", "# Введение"],
        ["i18n/de/docusaurus-plugin-content-blog/post.md", "# Blog"],
        ["src/page.mdx", "# Not docs"],
        ["docs/image.png", "binary"],
      ]),
    );

    expect(
      profile.documents.map(({ locale, path: documentPath, version }) => ({
        locale,
        path: documentPath,
        version,
      })),
    ).toEqual([
      {
        locale: "default",
        path: "docs/intro.md",
        version: "current",
      },
      {
        locale: "ru",
        path: "i18n/ru/docusaurus-plugin-content-docs/current/intro.md",
        version: "current",
      },
      {
        locale: "default",
        path: "versioned_docs/version-2.1/guide.mdx",
        version: "2.1",
      },
    ]);
    expect(profile.locales).toEqual(["default", "ru"]);
  });

  it("limits discovery to the configured project root", () => {
    const profile = analyzeDocusaurusFiles(
      new Map([
        ["products/one/docs/a.md", "# One"],
        ["products/two/docs/b.md", "# Two"],
        ["products/one/README.md", "# Ignore"],
      ]),
      "/products/one/",
    );
    expect(profile.root).toBe("/products/one/");
    expect(profile.documents.map((document) => document.path)).toEqual(["docs/a.md"]);
  });

  it("chooses a frontmatter title before a heading and filename", () => {
    const profile = analyzeDocusaurusFiles(
      new Map([
        ["docs/a.mdx", "---\ntitle: ' Frontmatter title '\n---\n# Heading"],
        ["docs/b.md", "# Heading title"],
        ["docs/file_name.md", "Paragraph"],
      ]),
    );
    expect(profile.documents.map((document) => document.title)).toEqual([
      "Frontmatter title",
      "Heading title",
      "file name",
    ]);
  });

  it("sorts and deduplicates detected MDX components", () => {
    const profile = analyzeDocusaurusFiles(
      new Map([
        ["docs/b.mdx", "<Tabs.Group><Card /></Tabs.Group>"],
        ["docs/a.mdx", "<Card /><Alert.Warning />"],
      ]),
    );
    expect(profile.unknownComponents).toEqual(["Alert.Warning", "Card", "Tabs.Group"]);
    expect(profile.documents.map((document) => document.path)).toEqual([
      "docs/a.mdx",
      "docs/b.mdx",
    ]);
  });

  it("computes a stable SHA-256 content hash", () => {
    const document = analyzeDocusaurusFiles(new Map([["docs/hello.md", "hello"]])).documents[0];
    expect(document?.contentHash).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
    expect(document?.status).toBe("clean");
  });
});

describe("Docusaurus project discovery", () => {
  it("reads MDX without executing project code", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-content-"));
    await mkdir(path.join(directory, "docs"));
    await writeFile(
      path.join(directory, "docs", "intro.mdx"),
      "---\ntitle: Начало работы\n---\n\n<SupportLink />\n",
    );
    await writeFile(path.join(directory, "docusaurus.config.ts"), "throw new Error('do not run')");

    const profile = await discoverDocusaurusProject(directory);

    expect(profile.root).toBe(path.resolve(directory));
    expect(profile.documents[0]?.title).toBe("Начало работы");
    expect(profile.unknownComponents).toEqual(["SupportLink"]);
  });

  it("returns an empty profile when the project has no documentation", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-content-empty-"));
    expect(await discoverDocusaurusProject(directory)).toMatchObject({
      documents: [],
      locales: [],
      unknownComponents: [],
      version: "docusaurus",
    });
  });
});
