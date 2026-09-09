export interface CatalogComponent {
  id: string;
  name: string;
  label: string;
  description: string;
  snippet: string;
  source: string;
}
export interface ComponentExample {
  snippet: string;
  path?: string;
}

const importNotice = "Найден при импорте MDX. Настройте шаблон перед использованием.";
export function componentDescription(description: string) {
  return description === importNotice ? "" : description;
}

// Only extract source text. Repository expressions and imports are never executed.
export function componentExamples(
  components: CatalogComponent[],
  files: { path: string; content: string }[],
) {
  const result: Record<string, ComponentExample> = {};
  const ordered = [...files].sort(
    (a, b) =>
      Number(a.path.startsWith("i18n/")) - Number(b.path.startsWith("i18n/")) ||
      a.path.localeCompare(b.path),
  );
  for (const component of components) {
    if (component.source !== "detected") {
      result[component.name] = { snippet: component.snippet };
      continue;
    }
    const name = (component.name === "TabItem" ? "Tabs" : component.name).replace(
      /[.*+?^${}()|[\]\\]/g,
      "\\$&",
    );
    const tag = new RegExp(`<\\/?${name}(?=[\\s/>])(?:"[^"]*"|'[^']*'|[^'">])*?>`, "g");
    for (const file of ordered) {
      const source = withoutFences(file.content);
      tag.lastIndex = 0;
      let start = -1;
      let depth = 0;
      for (const match of source.matchAll(tag)) {
        const closing = match[0].startsWith("</");
        if (!closing && depth === 0) start = match.index;
        if (closing) depth--;
        else if (!match[0].endsWith("/>")) depth++;
        if (depth !== 0 || start < 0) continue;
        const body = source.slice(start, match.index + match[0].length);
        if (body.length > 8000) {
          start = -1;
          continue;
        }
        const names = new Set([...body.matchAll(/<([A-Z][\w.]*)/g)].map((item) => item[1]));
        const imports = (source.match(/^import\s[\s\S]*?from\s*['"][^'"]+['"];?/gm) ?? [])
          .filter((line) =>
            [...names].some(
              (item) =>
                item &&
                new RegExp(`\\b${item.replaceAll(".", "\\.")}\\b`).test(
                  line.split("from")[0] ?? "",
                ),
            ),
          )
          .map((line) =>
            line.replace(
              /(from\s*['"])(\.[^'"]+)(['"])/,
              (_, before: string, relative: string, after: string) => {
                const parts = file.path.split("/").slice(0, -1);
                for (const segment of relative.split("/")) {
                  if (segment === "..") parts.pop();
                  else if (segment !== ".") parts.push(segment);
                }
                return `${before}@site/${parts.join("/")}${after}`;
              },
            ),
          );
        result[component.name] = {
          snippet: [...imports, "", body].join("\n").trim(),
          path: file.path,
        };
        break;
      }
      if (result[component.name]) break;
    }
    result[component.name] ??= { snippet: component.snippet };
  }
  return result;
}

function withoutFences(source: string) {
  let fence = "";
  return source
    .split("\n")
    .map((line) => {
      const marker = line.match(/^\s*(`{3,}|~{3,})/);
      if (marker?.[1]) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
        return "";
      }
      return fence ? "" : line;
    })
    .join("\n");
}
