export interface PreviewContext {
  projectId: string;
  branch: string;
  path: string;
  repositoryPaths: string[];
  locale?: string;
  media?: { directory: string; publicUrl: string };
}

interface Node {
  type: string;
  name?: string;
  value?: string;
  url?: string;
  children?: Node[];
  attributes?: { type: string; name?: string; value?: unknown }[];
  data?: { hName?: string; hProperties?: Record<string, unknown>; directiveLabel?: boolean };
}

const admonitions: Record<string, string> = {
  note: "Примечание",
  tip: "Совет",
  info: "Информация",
  warning: "Внимание",
  caution: "Осторожно",
  danger: "Опасность",
};
const tags = new Set([
  "a",
  "p",
  "div",
  "span",
  "br",
  "hr",
  "strong",
  "em",
  "b",
  "i",
  "u",
  "s",
  "del",
  "sup",
  "sub",
  "kbd",
  "code",
  "pre",
  "img",
  "figure",
  "figcaption",
  "details",
  "summary",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tr",
  "th",
  "td",
  "blockquote",
]);

export function preparePreviewSource(source: string) {
  let fence = "";
  return source
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, "")
    .split("\n")
    .map((line) => {
      const marker = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (marker?.[1]) {
        if (!fence) fence = marker[1];
        else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = "";
        return line;
      }
      if (fence) return line;
      // Docusaurus accepts a plain title after the directive name.
      const directive = line.match(
        /^(\s*:{3,}(?:note|tip|info|warning|caution|danger))\s+(.+?)\s*$/,
      );
      if (directive) return `${directive[1]}[${directive[2]}]`;
      // Keep imports separate from a preceding paragraph while editing.
      if (/^import\s/.test(line)) return `\n${line}`;
      return line;
    })
    .join("\n");
}

function normalizedPath(value: string) {
  const parts: string[] = [];
  for (const part of value.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (!parts.length) return undefined;
      parts.pop();
    } else parts.push(part);
  }
  return parts.join("/");
}

export function previewAssetUrl(url: string, context: PreviewContext) {
  if (/^(https?:)?\/\//i.test(url)) return url;
  let value = url.replace(/^pathname:\/\//, "");
  if (/^[a-z][\w+.-]*:/i.test(value)) return "";
  value = value.split(/[?#]/)[0] ?? "";
  try {
    value = decodeURIComponent(value);
  } catch {
    return "";
  }
  const directory = context.path.split("/").slice(0, -1).join("/");
  const candidates = value.startsWith("@site/")
    ? [value.slice(6)]
    : value.startsWith("/")
      ? [`static/${value.slice(1)}`, value.slice(1)]
      : [`${directory}/${value}`, value];
  if (value.startsWith("/")) {
    const relative = context.path.replace(/^[^/]+\//, "");
    const values: Record<string, string> = {
      locale: context.locale ?? "ru",
      documentDir: relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "",
      document: relative.replace(/\.[^.]+$/, ""),
    };
    const expand = (template: string) =>
      template.replace(/\{(locale|documentDir|document)\}/g, (_, key: string) => values[key] ?? "");
    if (context.media) {
      const publicRoot = expand(context.media.publicUrl)
        .replace(/^pathname:\/\//, "")
        .replace(/\/+$/, "");
      if (value.startsWith(`${publicRoot}/`))
        candidates.unshift(
          `${expand(context.media.directory)}/${value.slice(publicRoot.length + 1)}`,
        );
    }
    // Resolve additional static directories from the imported tree, with the current locale first.
    const matching = context.repositoryPaths.filter((path) => path.endsWith(value));
    matching.sort(
      (a, b) =>
        Number(b.includes(`/${values.locale}/`)) - Number(a.includes(`/${values.locale}/`)) ||
        a.localeCompare(b),
    );
    candidates.push(...matching);
    const localized = matching.find((path) => path.includes(`/${values.locale}/`));
    if (localized) candidates.unshift(localized);
  }
  const paths = candidates.map(normalizedPath).filter((path): path is string => Boolean(path));
  const path = paths.find((candidate) => context.repositoryPaths.includes(candidate)) ?? paths[0];
  return path
    ? `/api/projects/${context.projectId}/assets?${new URLSearchParams({ branch: context.branch, path })}`
    : "";
}

export function previewPlugin(context: PreviewContext) {
  return () => (root: { type: string }) => {
    function element(node: Node, tag: string, props: Record<string, unknown> = {}) {
      node.type = "previewElement";
      node.data = { hName: tag, hProperties: props };
      delete node.value;
    }
    function transform(parent: Node) {
      parent.children = parent.children?.flatMap((node): Node[] => {
        if (node.type === "mdxjsEsm") return [];
        if (node.type === "mdxFlowExpression" || node.type === "mdxTextExpression") {
          if (/^\s*\/\*/.test(node.value ?? "")) return [];
          // Expressions are represented, never evaluated in the editor's origin.
          return [{ type: "inlineCode", value: `{${node.value ?? ""}}` }];
        }
        if (node.type === "image" && node.url) node.url = previewAssetUrl(node.url, context);
        if (node.type === "definition" && node.url && !/^(https?:|mailto:|#)/.test(node.url)) {
          // Definitions can be shared by Markdown images and links.
          if (/\.(png|jpe?g|gif|svg|webp|avif)([?#]|$)/i.test(node.url))
            node.url = previewAssetUrl(node.url, context);
        }
        if (node.type === "containerDirective" && node.name && admonitions[node.name]) {
          const name = node.name;
          const title = node.children?.[0]?.data?.directiveLabel
            ? node.children.shift()
            : { type: "paragraph", children: [{ type: "text", value: admonitions[name] }] };
          if (title) {
            element(title, "div", { className: "wb-admonition-title" });
            node.children?.unshift(title);
          }
          element(node, "aside", {
            role: "note",
            className: `wb-admonition wb-admonition--${name}`,
          });
        }
        if (node.type === "mdxJsxFlowElement" || node.type === "mdxJsxTextElement") {
          const name = node.name ?? "";
          const inline = node.type === "mdxJsxTextElement";
          if (["script", "style", "iframe", "object", "embed"].includes(name)) return [];
          const attributes: Record<string, string> = {};
          for (const attribute of node.attributes ?? []) {
            if (
              attribute.type === "mdxJsxAttribute" &&
              attribute.name &&
              typeof attribute.value === "string"
            )
              attributes[attribute.name] = attribute.value;
          }
          if (tags.has(name)) {
            const props: Record<string, unknown> = {};
            for (const key of ["href", "title", "alt", "width", "height", "colSpan", "rowSpan"])
              if (attributes[key]) props[key] = attributes[key];
            if (name === "img" && attributes.src)
              props.src = previewAssetUrl(attributes.src, context);
            element(node, name, props);
          } else if (name === "Details") {
            node.children ??= [];
            node.children.unshift({
              type: "paragraph",
              children: [{ type: "text", value: attributes.summary ?? "Подробнее" }],
              data: { hName: "summary" },
            });
            element(node, "details");
          } else if (name === "Video") {
            element(node, "video", {
              controls: true,
              preload: "none",
              src: previewAssetUrl(attributes.src ?? "", context),
            });
          } else if (name === "Redirect") {
            node.children = [{ type: "text", value: `Перенаправление на ${attributes.to ?? "/"}` }];
            element(node, "p");
          } else if (name === "SupportLink") {
            element(node, "span", {
              className: "wb-preview-support",
              title: "Ссылка на чат поддержки",
            });
          } else if (name === "Tabs") {
            node.children = node.children?.flatMap((child) =>
              child.type === "paragraph" ? (child.children ?? []) : [child],
            );
            element(node, "div", { className: "wb-preview-tabs" });
          } else if (name === "TabItem") {
            element(node, inline ? "span" : "div", {
              className: "wb-preview-tab",
              "data-label": attributes.label ?? attributes.value ?? "Вкладка",
            });
          } else if (!name) {
            element(node, inline ? "span" : "div");
          } else {
            if (!node.children?.length)
              node.children = [{ type: "text", value: `${name} · Превью доступно на сайте` }];
            element(node, inline ? "span" : "div", {
              className: "wb-preview-component",
              title: `Компонент ${name}. Полный вид доступен через «Открыть сайт».`,
            });
          }
        }
        transform(node);
        return [node];
      });
    }
    transform(root as Node);
  };
}
