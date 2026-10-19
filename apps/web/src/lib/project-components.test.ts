import { expect, it } from "vitest";
import { projectComponentCatalog } from "./project-components";

const registry = {
  path: "src/theme/MDXComponents/index.tsx",
  content:
    "import type {MDXComponents} from 'mdx/types'; export default { DocMedia, SupportLink, Tabs, TabItem } satisfies MDXComponents;",
};
const component = (name: string, snippet = `<${name} />`) => ({
  id: name,
  name,
  label: name,
  description: "",
  snippet,
  source: "detected",
});

it("discovers globals in TSX registries and uses media templates only with explicit integration", () => {
  const catalog = projectComponentCatalog([], [registry], {
    DocMedia: { storage: "images", srcBase: "/img" },
  });
  expect(catalog.components.map((item) => item.name)).toEqual([
    "DocMedia",
    "SupportLink",
    "TabItem",
    "Tabs",
  ]);
  expect(catalog.insertableComponents).toHaveLength(4);
  expect(catalog.insertableComponents.find((item) => item.name === "DocMedia")?.snippet).toBe(
    '<DocMedia src="" alt="Описание изображения" />',
  );
  expect(
    projectComponentCatalog([], [registry]).components.find((item) => item.name === "DocMedia")
      ?.snippet,
  ).toBe("<DocMedia />");
  expect(catalog.components.find((item) => item.name === "TabItem")?.snippet).toContain("<Tabs>");
});

it("preserves manual import-based templates even when a registry is absent, deleted or dynamic", () => {
  const snippet = 'import Local from "@site/src/components/Local";\n\n<Local title="Keep" />';
  const stored = [{ ...component("Local", snippet), source: "manual" }];
  for (const files of [
    [],
    [{ ...registry, status: "delete" }],
    [{ ...registry, content: "export default load();" }],
  ]) {
    expect(projectComponentCatalog(stored, files).insertableComponents).toEqual([
      expect.objectContaining({ snippet, unavailableReason: undefined }),
    ]);
  }
});

it("keeps local imports in examples and requires a template for unregistered detected tags", () => {
  const snippet = 'import Local from "@site/src/components/Local";\n\n<Local title="Keep" />';
  const catalog = projectComponentCatalog(
    [component("Local"), component("Unknown")],
    [registry, { path: "docs/a.mdx", content: snippet }],
  );
  expect(catalog.examples.Local?.snippet).toBe(snippet);
  expect(catalog.insertableComponents.find((item) => item.name === "Local")?.snippet).toBe(snippet);
  expect(catalog.insertableComponents.some((item) => item.name === "Unknown")).toBe(false);
});
