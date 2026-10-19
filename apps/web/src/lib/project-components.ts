import { globalMdxSnippet, isMdxComponentsPath, registeredMdxComponents } from "@pushdocs/content";
import {
  type CatalogComponent,
  type ComponentExample,
  componentExamples,
} from "@/components/component-examples";

const tabs = {
  snippet:
    '<Tabs>\n  <TabItem value="first" label="Первый">\n\nТекст первой вкладки.\n\n  </TabItem>\n  <TabItem value="second" label="Второй">\n\nТекст второй вкладки.\n\n  </TabItem>\n</Tabs>',
};
const defaults: Record<string, { snippet: string; description?: string }> = {
  DocMedia: {
    snippet: '<DocMedia src="folder/image.png" alt="Описание изображения" />',
    description:
      "Изображение или MP4 из медиатеки. Выберите файл или загрузите новый в папку статьи.",
  },
  Tabs: tabs,
  TabItem: tabs,
  SupportLink: { snippet: "<SupportLink>Написать в поддержку</SupportLink>" },
  Video: {
    snippet: '<Video src="" />',
    description: "MP4 из медиатеки. Выберите файл или загрузите новый в папку статьи.",
  },
};

/** The registry belongs to the selected branch, rather than the project-wide detected-tag list. */
export function projectComponentCatalog(
  stored: CatalogComponent[],
  files: { path: string; content: string; status?: string }[],
) {
  const active = files.filter((file) => file.status !== "delete");
  const registry = active.find((file) => isMdxComponentsPath(file.path));
  const registered = registry ? registeredMdxComponents(registry.content) : undefined;
  const names = new Set(registered ?? []);
  const byName = new Map(stored.map((component) => [component.name, component]));
  for (const name of names)
    if (!byName.has(name))
      byName.set(name, {
        id: `global:${name}`,
        name,
        label: name,
        description: defaults[name]?.description ?? "",
        snippet: defaults[name]?.snippet ?? `<${name} />`,
        source: "detected",
      });
  const components = [...byName.values()]
    .map((component) => ({
      ...component,
      description: defaults[component.name]?.description ?? component.description,
      snippet:
        component.source === "detected"
          ? (defaults[component.name]?.snippet ?? component.snippet)
          : component.snippet,
    }))
    .sort((left, right) => left.label.localeCompare(right.label));
  const examples = componentExamples(components, active);
  const prepared: Record<string, ComponentExample> = {};
  const catalog = components.map((component) => {
    const example = examples[component.name] ?? { snippet: component.snippet };
    const snippet = names.has(component.name)
      ? globalMdxSnippet(example.snippet, registered ?? [])
      : undefined;
    const fallback = names.has(component.name)
      ? globalMdxSnippet(component.snippet, registered ?? [])
      : undefined;
    // A document example can depend on other local components. Use the standalone template then.
    prepared[component.name] =
      snippet !== undefined ? { ...example, snippet } : { snippet: fallback ?? example.snippet };
    const unavailableReason = !registered
      ? "Не удалось проверить MDXComponents. Обновите ветку или проверьте регистрацию компонента."
      : !names.has(component.name)
        ? "Компонент не зарегистрирован в MDXComponents и требует импорта в документе."
        : fallback === undefined
          ? "Шаблон требует локальных импортов или незарегистрированных компонентов."
          : undefined;
    return { ...component, snippet: fallback ?? component.snippet, unavailableReason };
  });
  return {
    components: catalog,
    examples: prepared,
    insertableComponents: catalog.filter((component) => !component.unavailableReason),
  };
}
