import { expect, it } from "vitest";
import { globalMdxSnippet, registeredMdxComponents } from "./mdx-components";

it("reads explicitly registered globals, including aliases and object spreads, without executing code", () => {
  expect(
    registeredMdxComponents(`
      import original from '@theme-original/MDXComponents';
      import Media from './DocMedia';
      const extra = { SupportLink, 'Tabs': Tabs };
      const components = { ...original, ...extra, DocMedia: Media, p: Paragraph };
      throw new Error('Must not run');
      export default components;
    `),
  ).toEqual(["DocMedia", "SupportLink", "Tabs"]);
});

it.each([
  "export default loadComponents();",
  "export default { ...unknown };",
  "export default { [getName()]: Widget };",
  "const a = b; const b = a; export default a;",
  "export default {",
])("does not claim a dynamic or invalid registry is verified: %s", (source) => {
  expect(registeredMdxComponents(source)).toBeUndefined();
});

it("removes global imports, including multiline declarations, while preserving body bytes", () => {
  const body =
    '<Tabs>\r\n<TabItem value="a">\r\n<DocMedia src="a.png" alt="A" />\r\n</TabItem>\r\n</Tabs>';
  expect(
    globalMdxSnippet(
      `import Tabs from '@theme/Tabs';\r\nimport {\r\n  TabItem, DocMedia\r\n} from './components';\r\n\r\n${body}`,
      ["Tabs", "TabItem", "DocMedia"],
    ),
  ).toBe(body);
});

it("rejects local imports, nested unregistered tags and invalid MDX", () => {
  for (const snippet of [
    "import Image from './a.png';\n\n<DocMedia src={Image} />",
    "import './side-effect';\n\n<DocMedia />",
    "export const x = 1;\n\n<DocMedia />",
    "<DocMedia><Local /></DocMedia>",
    "<DocMedia>",
  ])
    expect(globalMdxSnippet(snippet, ["DocMedia"])).toBeUndefined();
});

it("keeps fenced and inline code examples intact", () => {
  const snippet = '<DocMedia src="a.png" alt="A" />\n\n```mdx\n<Local />\n```\n\n`<Another />`';
  expect(globalMdxSnippet(snippet, ["DocMedia"])).toBe(snippet);
});
