import { type ProjectConfig, projectConfigSchema } from "@pushdocs/contracts";
import { applyEditorInput } from "./editing";

export function safePath(value: string): string {
  if (
    !value ||
    value.length > 1000 ||
    value.includes("\\") ||
    [...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127) ||
    value.startsWith("/") ||
    value
      .split("/")
      .some((part) => !part || part === "." || part === ".." || part.toLowerCase() === ".git")
  )
    throw new Error("Недопустимый путь файла");
  return value;
}

export function parseProjectConfig(source?: string | null): ProjectConfig {
  const config = projectConfigSchema.parse(source ? JSON.parse(source) : { version: 1 });
  for (const root of [...config.documentRoots, ...config.editableFiles]) safePath(root);
  safePath(config.preview.output);
  return config;
}

function expand(source: string, values: Record<string, string>): string {
  return source.replace(/\{([a-zA-Z]+)\}/g, (_match, key: string) => {
    if (!(key in values)) throw new Error(`Не задано поле шаблона: ${key}`);
    return values[key] ?? "";
  });
}

export function planDocument(
  config: ProjectConfig,
  templateId: string,
  values: Record<string, string>,
): Array<{ path: string; content: string }> {
  const template = config.templates.find((item) => item.id === templateId);
  if (!template) throw new Error("Шаблон не найден");
  const result = [template, ...template.companions].map((item) => ({
    path: safePath(expand(item.path, values)),
    content: expand(item.content, values),
  }));
  if (new Set(result.map((item) => item.path)).size !== result.length)
    throw new Error("Шаблон создаёт одинаковые пути");
  return result;
}

export function planTemplate(
  config: ProjectConfig,
  templateId: string,
  values: Record<string, string>,
  existing: ReadonlyMap<string, string>,
) {
  const files = new Map(
    planDocument(config, templateId, values).map((file) => [
      file.path,
      { ...file, createOnly: true },
    ]),
  );
  const updates = config.templates.find((item) => item.id === templateId)?.updates ?? [];
  for (const update of updates) {
    const filePath = safePath(expand(update.path, values));
    if (files.get(filePath)?.createOnly)
      throw new Error("Шаблон одновременно создаёт и изменяет один файл");
    const source = files.get(filePath)?.content ?? existing.get(filePath);
    if (source === undefined) throw new Error(`Связанный файл не найден: ${filePath}`);
    const find = expand(update.find, values).replace(/\r\n?/g, "\n");
    const replacement = expand(update.replace, values).replace(/\r\n?/g, "\n");
    const displayed = source.replace(/\r\n?/g, "\n");
    const offset = displayed.indexOf(find);
    if (!find || offset < 0 || displayed.indexOf(find, offset + 1) >= 0)
      throw new Error(
        `Правило неоднозначно или не подходит к файлу: ${filePath}. Используйте исходник.`,
      );
    const content = applyEditorInput(
      source,
      displayed.slice(0, offset) + replacement + displayed.slice(offset + find.length),
    );
    if (content.length > 5_000_000) throw new Error("Результат шаблона превышает лимит файла");
    files.set(filePath, { path: filePath, content, createOnly: false });
  }
  return [...files.values()];
}

export function assetLocation(
  config: ProjectConfig,
  locale: string,
  documentPath: string,
  name: string,
) {
  if (!/^[a-zA-Z0-9_-]+$/.test(locale) || !name || name.includes("/") || name.includes("\\"))
    throw new Error("Недопустимый путь вложения");
  const relative = documentPath.replace(/^[^/]+\//, "");
  const documentDir = relative.includes("/") ? relative.slice(0, relative.lastIndexOf("/")) : "";
  const values = { locale, documentDir, document: relative.replace(/\.[^.]+$/, "") };
  const directory = expand(config.media.directory, values).replace(/\/+$/, "");
  const publicUrl = expand(config.media.publicUrl, values).replace(/\/+$/, "");
  if (
    publicUrl.startsWith("//") ||
    (!publicUrl.startsWith("/") && !publicUrl.startsWith("pathname:///"))
  )
    throw new Error("URL вложения должен быть локальным");
  return {
    path: safePath(`${directory}/${name}`),
    url: `${publicUrl}/${encodeURIComponent(name)}`,
  };
}

export function isEditableFile(config: ProjectConfig, filePath: string): boolean {
  safePath(filePath);
  return (
    filePath === ".pushdocs/config.json" ||
    config.editableFiles.includes(filePath) ||
    (/\.(mdx?|json)$/i.test(filePath) &&
      config.documentRoots.some((root) => filePath.startsWith(`${root}/`)))
  );
}
