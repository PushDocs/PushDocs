import { parseProjectConfig } from "@pushdocs/content/config";
import { docMediaUrl, mediaReferenceCandidates } from "@pushdocs/content/media-paths";
import type { ProjectConfig } from "@pushdocs/contracts";
export interface PreviewContext {
  projectId: string;
  branch: string;
  path: string;
  repositoryPaths: string[];
  locale?: string;
  defaultLocale?: string;
  media?: ProjectConfig["media"];
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

export function preparePreviewSource(source: string, lineMap?: number[]) {
  let fence = "";
  return source
    .replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/, (header) =>
      header.replace(/[^\n]/g, ""),
    )
    .split("\n")
    .map((line, index) => {
      lineMap?.push(index + 1);
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
      if (/^import\s/.test(line)) {
        lineMap?.push(index + 1);
        return `\n${line}`;
      }
      return line;
    })
    .join("\n");
}

function previewConfig(context: PreviewContext) {
  return parseProjectConfig(
    JSON.stringify({
      version: 1,
      ...(context.defaultLocale ? { defaultLocale: context.defaultLocale } : {}),
      ...(context.media ? { media: context.media } : {}),
    }),
  );
}
function previewLocale(context: PreviewContext, config: ProjectConfig) {
  return context.locale && context.locale !== "default"
    ? context.locale
    : (context.path.match(/^i18n\/([^/]+)\//)?.[1] ?? config.defaultLocale);
}
export function previewAssetUrl(url: string, context: PreviewContext) {
  if (/^(https?:)?\/\//i.test(url)) return url;
  const config = previewConfig(context);
  const candidates = mediaReferenceCandidates(
    config,
    previewLocale(context, config),
    context.path,
    url,
  );
  const path =
    candidates.find((candidate) => context.repositoryPaths.includes(candidate)) ?? candidates[0];
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
          } else if (name === "DocMedia") {
            const config = previewConfig(context);
            const src = attributes.src
              ? (docMediaUrl(config, previewLocale(context, config), attributes.src) ?? "")
              : "";
            const video = /\.mp4(?:[?#]|$)/i.test(src);
            element(node, video ? "video" : "img", {
              src: src ? previewAssetUrl(src, context) : "",
              alt: attributes.alt ?? "",
              ...(video ? { controls: true, preload: "none", "aria-label": attributes.alt } : {}),
              ...Object.fromEntries(
                ["width", "height", "title"]
                  .filter((key) => attributes[key])
                  .map((key) => [key, attributes[key]]),
              ),
            });
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
            node.children = [
              {
                type: inline ? "text" : "paragraph",
                value: inline ? `${name} · Упрощённое превью · ` : undefined,
                children: inline
                  ? undefined
                  : [{ type: "text", value: `${name} · Упрощённое превью` }],
              },
              ...(node.children ?? []),
            ];
            element(node, inline ? "span" : "div", {
              className: "wb-preview-component",
              title: `Компонент ${name}. Полный вид доступен в предпросмотре после отправки изменений.`,
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
