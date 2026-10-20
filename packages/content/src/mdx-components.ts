import ts from "typescript";

export const mdxComponentPaths = ["tsx", "ts", "jsx", "js"].flatMap((extension) => [
  `src/theme/MDXComponents/index.${extension}`,
  `src/theme/MDXComponents.${extension}`,
]);

export function isMdxComponentsPath(path: string) {
  return mdxComponentPaths.includes(path);
}

/** Inspect TS/TSX/JSX syntax without importing or executing repository code. */
export function registeredMdxComponents(
  source: string,
  fileName = "registry.tsx",
): string[] | undefined {
  const parsed = ts.transpileModule(source, {
    fileName,
    compilerOptions: {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.Preserve,
    },
    reportDiagnostics: true,
  });
  if (parsed.diagnostics?.some((diagnostic) => diagnostic.category === ts.DiagnosticCategory.Error))
    return undefined;
  const program = ts.createSourceFile(
    "registry.jsx",
    parsed.outputText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JSX,
  );
  const variables = new Map<string, ts.Expression>();
  const inherited = new Set<string>();
  let exported: ts.Expression | undefined;
  for (const statement of program.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "@theme-original/MDXComponents"
    ) {
      const name = statement.importClause?.name;
      if (name) inherited.add(name.text);
    }
    if (ts.isVariableStatement(statement))
      for (const declaration of statement.declarationList.declarations)
        if (ts.isIdentifier(declaration.name) && declaration.initializer)
          variables.set(declaration.name.text, declaration.initializer);
    if (ts.isExportAssignment(statement) && !statement.isExportEquals)
      exported = statement.expression;
  }
  const visiting = new Set<ts.Node>();
  function names(node: ts.Expression): string[] {
    if (visiting.has(node)) throw new Error("Cyclic registry");
    visiting.add(node);
    try {
      if (ts.isParenthesizedExpression(node)) return names(node.expression);
      if (ts.isIdentifier(node)) {
        if (inherited.has(node.text)) return [];
        const value = variables.get(node.text);
        if (!value) throw new Error("Dynamic registry");
        return names(value);
      }
      if (!ts.isObjectLiteralExpression(node)) throw new Error("Dynamic registry");
      return node.properties.flatMap((property) => {
        if (ts.isSpreadAssignment(property)) return names(property.expression);
        if (
          (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) ||
          !property.name ||
          ts.isComputedPropertyName(property.name)
        )
          throw new Error("Dynamic registry key");
        const key = property.name;
        const name = ts.isIdentifier(key) || ts.isStringLiteral(key) ? key.text : "";
        return /^[A-Z]\w*$/.test(name) ? [name] : [];
      });
    } finally {
      visiting.delete(node);
    }
  }
  try {
    return exported ? [...new Set(names(exported))].sort() : undefined;
  } catch {
    return undefined;
  }
}
