import { expect, it } from "vitest";
import { registeredMdxComponents } from "./mdx-components";

it("reads registered globals and shared spreads without executing repository code", () => {
  expect(
    registeredMdxComponents(`
    import original from '@theme-original/MDXComponents';
    import Media from './DocMedia';
    const extra = { SupportLink, 'Tabs': Tabs };
    export default { ...original, ...extra, ...extra, DocMedia: Media, p: Paragraph };
    throw new Error('Must not run');
  `),
  ).toEqual(["DocMedia", "SupportLink", "Tabs"]);
});

it.each([
  [
    "registry.tsx",
    `import type {MDXComponents} from 'mdx/types';
    const components: MDXComponents = { Media: props => <img {...props} /> };
    export default components satisfies MDXComponents;`,
  ],
  [
    "registry.ts",
    `import type {MDXComponents} from 'mdx/types';
    export default <MDXComponents>{ Media };`,
  ],
  ["registry.jsx", `export default { Media: props => <img {...props} /> };`],
])("supports the declared registry syntax in %s", (fileName, source) => {
  expect(registeredMdxComponents(source, fileName)).toEqual(["Media"]);
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
