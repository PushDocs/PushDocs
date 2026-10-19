import { isMdxComponentsPath, registeredMdxComponents } from "@pushdocs/content";
import type { ProjectConfig } from "@pushdocs/contracts";
import {
  type CatalogComponent,
  type ComponentExample,
  componentExamples,
} from "@/components/component-examples";

const tabsSnippet =
  '<Tabs>\n  <TabItem value="first" label="Первый">\n\nТекст первой вкладки.\n\n  </TabItem>\n  <TabItem value="second" label="Второй">\n\nТекст второй вкладки.\n\n  </TabItem>\n</Tabs>';

/** Registry discovery supplements the catalog; manual templates may also use local imports. */
export function projectComponentCatalog(
  stored: CatalogComponent[],
  files: { path: string; content: string; status?: string }[],
  mediaComponents: ProjectConfig["media"]["components"] = {},
) {
  const active = files.filter((file) => file.status !== "delete");
  const registry = active.find((file) => isMdxComponentsPath(file.path));
  const names = new Set(registry ? registeredMdxComponents(registry.content, registry.path) : []);
  const byName = new Map(stored.map((component) => [component.name, component]));
  for (const name of names)
    if (!byName.has(name))
      byName.set(name, {
        id: `global:${name}`,
        name,
        label: name,
        description: "",
        snippet: `<${name} />`,
        source: "detected",
      });
  const components = [...byName.values()]
    .map((component) => {
      if (component.source !== "detected" || !names.has(component.name)) return component;
      const media = mediaComponents[component.name];
      return {
        ...component,
        snippet: media
          ? "<" +
            component.name +
            ' src=""' +
            (media.storage === "images" ? ' alt="Описание изображения"' : "") +
            " />"
          : ["Tabs", "TabItem"].includes(component.name)
            ? tabsSnippet
            : component.snippet,
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
  const examples = componentExamples(components, active);
  const prepared: Record<string, ComponentExample> = {};
  const catalog = components.map((component) => {
    const example = examples[component.name] ?? { snippet: component.snippet };
    // Verified globals use their standalone template. Local examples retain all imports.
    const insertable =
      component.source !== "detected" ||
      names.has(component.name) ||
      /^import\s/m.test(example.snippet);
    const snippet =
      component.source === "detected" && !names.has(component.name)
        ? example.snippet
        : component.snippet;
    prepared[component.name] = example;
    return {
      ...component,
      snippet,
      unavailableReason: insertable
        ? undefined
        : "Настройте шаблон с импортом или зарегистрируйте компонент в MDXComponents.",
    };
  });
  return {
    components: catalog,
    examples: prepared,
    insertableComponents: catalog.filter((component) => !component.unavailableReason),
  };
}
