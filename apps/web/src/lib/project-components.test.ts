import { expect, it } from "vitest";
import { projectComponentCatalog } from "./project-components";

const registry = {
  path: "src/theme/MDXComponents/index.tsx",
  content: "export default { DocMedia, SupportLink, Tabs, TabItem };",
};
const component = (name: string, snippet = `<${name} />`) => ({
  id: name,
  name,
  label: name,
  description: "",
  snippet,
  source: "detected",
});

it("adds unused globals to settings and to the insert menu with usable import-free snippets", () => {
  const catalog = projectComponentCatalog([], [registry]);
  expect(catalog.components.map((item) => item.name)).toEqual([
    "DocMedia",
    "SupportLink",
    "TabItem",
    "Tabs",
  ]);
  expect(catalog.insertableComponents).toHaveLength(4);
  expect(catalog.insertableComponents.find((item) => item.name === "DocMedia")?.snippet).toBe(
    '<DocMedia src="folder/image.png" alt="Описание изображения" />',
  );
  expect(catalog.insertableComponents.find((item) => item.name === "TabItem")?.snippet).toContain(
    "<Tabs>",
  );
  for (const item of catalog.insertableComponents) expect(item.snippet).not.toMatch(/\bimport\b/);
});

it("strips legacy imports from real examples and excludes components absent in this branch", () => {
  const catalog = projectComponentCatalog(
    [component("DocMedia"), component("Local")],
    [
      registry,
      {
        path: "docs/a.mdx",
        content:
          'import DocMedia from "@site/src/components/DocMedia";\n\n<DocMedia src="real.png" alt="Real" />',
      },
    ],
  );
  expect(catalog.examples.DocMedia).toEqual({
    path: "docs/a.mdx",
    snippet: '<DocMedia src="real.png" alt="Real" />',
  });
  expect(catalog.components.find((item) => item.name === "Local")?.unavailableReason).toContain(
    "не зарегистрирован",
  );
  expect(catalog.insertableComponents.some((item) => item.name === "Local")).toBe(false);
});

it("does not allow unverified registries or manual templates with local dependencies", () => {
  const stored = [{ ...component("DocMedia", "<DocMedia><Local /></DocMedia>"), source: "manual" }];
  expect(projectComponentCatalog(stored, []).insertableComponents).toEqual([]);
  expect(
    projectComponentCatalog(stored, [{ ...registry, status: "delete" }]).insertableComponents,
  ).toEqual([]);
  expect(
    projectComponentCatalog(stored, [{ ...registry, content: "export default load();" }])
      .insertableComponents,
  ).toEqual([]);
  expect(
    projectComponentCatalog(stored, [registry]).insertableComponents.some(
      (item) => item.name === "DocMedia",
    ),
  ).toBe(false);
});
