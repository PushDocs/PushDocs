import { expect, it } from "vitest";
import {
  type CatalogComponent,
  componentDescription,
  componentExamples,
} from "./component-examples";

function component(name: string): CatalogComponent {
  return {
    id: name,
    name,
    label: name,
    description: "",
    snippet: `<${name} />`,
    source: "detected",
  };
}
it("extracts actual usage with imports and skips fenced code", () => {
  const result = componentExamples(
    [component("Details")],
    [
      {
        path: "docs/example.mdx",
        content:
          "```mdx\n<Details>Wrong</Details>\n```\n\nimport Details from '@theme/Details';\n\n<Details summary=\"a > b\"><Details>Nested</Details>Actual</Details>",
      },
    ],
  );
  expect(result.Details).toEqual({
    path: "docs/example.mdx",
    snippet:
      "import Details from '@theme/Details';\n\n<Details summary=\"a > b\"><Details>Nested</Details>Actual</Details>",
  });
});
it("includes the Tabs wrapper and both imports for TabItem", () => {
  const result = componentExamples(
    [component("TabItem")],
    [
      {
        path: "docs/example.mdx",
        content:
          "import Tabs from '@theme/Tabs';\nimport TabItem from '@theme/TabItem';\n\n<Tabs><TabItem value=\"a\" label=\"A\">Text</TabItem></Tabs>",
      },
    ],
  );
  expect(result.TabItem?.snippet).toContain("import Tabs");
  expect(result.TabItem?.snippet).toContain("import TabItem");
  expect(result.TabItem?.snippet).toContain("<Tabs>");
});
it("keeps configured snippets and descriptions and removes only the boilerplate", () => {
  const manual = {
    ...component("SupportLink"),
    source: "manual",
    snippet: "<SupportLink>Custom</SupportLink>",
  };
  expect(componentExamples([manual], []).SupportLink?.snippet).toBe(manual.snippet);
  expect(
    componentDescription("Найден при импорте MDX. Настройте шаблон перед использованием."),
  ).toBe("");
  expect(componentDescription("Ссылка в поддержку")).toBe("Ссылка в поддержку");
});
