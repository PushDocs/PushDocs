import { type Node, parse } from "acorn";
import remarkMdx from "remark-mdx";
import remarkParse from "remark-parse";
import { unified } from "unified";

type Ast = Node & { [key: string]: unknown };

export const mdxComponentPaths = ["tsx", "ts", "jsx", "js"].flatMap((extension) => [
  `src/theme/MDXComponents/index.${extension}`,
  `src/theme/MDXComponents.${extension}`,
]);

export function isMdxComponentsPath(path: string) {
  return mdxComponentPaths.includes(path);
}

/** Read the static registry without importing or executing repository code. */
export function registeredMdxComponents(source: string): string[] | undefined {
  try {
    const program = parse(source, { ecmaVersion: "latest", sourceType: "module" });
    const variables = new Map<string, Ast>();
    const inherited = new Set<string>();
    let exported: Ast | undefined;
    for (const statement of program.body as Ast[]) {
      if (statement.type === "ImportDeclaration") {
        if ((statement.source as Ast).value === "@theme-original/MDXComponents")
          for (const specifier of statement.specifiers as Ast[])
            inherited.add(String((specifier.local as Ast).name));
      }
      if (statement.type === "VariableDeclaration")
        for (const declaration of statement.declarations as Ast[])
          if ((declaration.id as Ast).type === "Identifier" && declaration.init)
            variables.set(String((declaration.id as Ast).name), declaration.init as Ast);
      if (statement.type === "ExportDefaultDeclaration") exported = statement.declaration as Ast;
    }
    const seen = new Set<Ast>();
    function names(node: Ast): string[] {
      if (seen.has(node)) throw new Error("Cyclic registry");
      seen.add(node);
      if (node.type === "Identifier") {
        if (inherited.has(String(node.name))) return [];
        const value = variables.get(String(node.name));
        if (!value) throw new Error("Dynamic registry");
        return names(value);
      }
      if (node.type !== "ObjectExpression") throw new Error("Dynamic registry");
      return (node.properties as Ast[]).flatMap((property) => {
        if (property.type === "SpreadElement") return names(property.argument as Ast);
        if (property.type !== "Property" || property.computed || property.kind !== "init")
          throw new Error("Dynamic registry key");
        const key = property.key as Ast;
        const name = String(key.type === "Identifier" ? key.name : key.value);
        return /^[A-Z]\w*$/.test(name) ? [name] : [];
      });
    }
    return exported ? [...new Set(names(exported))].sort() : undefined;
  } catch {
    return undefined;
  }
}

/** Strip redundant global imports and reject snippets needing local component bindings. */
export function globalMdxSnippet(
  source: string,
  registered: readonly string[],
): string | undefined {
  const globals = new Set(registered);
  try {
    const tree = unified().use(remarkParse).use(remarkMdx).parse(source);
    const removals: Array<{ start: number; end: number }> = [];
    let valid = true;
    function visit(node: {
      type: string;
      name?: string | null;
      value?: string;
      position?: { start: { offset?: number }; end: { offset?: number } };
      children?: unknown[];
    }) {
      if (node.type === "mdxjsEsm") {
        const esm = parse(node.value ?? "", { ecmaVersion: "latest", sourceType: "module" });
        for (const statement of esm.body as Ast[]) {
          if (
            statement.type !== "ImportDeclaration" ||
            !(statement.specifiers as Ast[]).length ||
            !(statement.specifiers as Ast[]).every((item) =>
              globals.has(String((item.local as Ast).name)),
            )
          )
            valid = false;
        }
        const start = node.position?.start.offset;
        const end = node.position?.end.offset;
        if (start !== undefined && end !== undefined) removals.push({ start, end });
      }
      if (node.name && /^[A-Z]/.test(node.name) && !globals.has(node.name)) valid = false;
      for (const child of node.children ?? []) visit(child as Parameters<typeof visit>[0]);
    }
    visit(tree);
    if (!valid) return undefined;
    for (const { start, end } of removals.reverse())
      source = source.slice(0, start) + source.slice(end);
    return source.trim();
  } catch {
    return undefined;
  }
}
