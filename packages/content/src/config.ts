import {
  defaultMediaLocations,
  type ProjectConfig,
  projectConfigSchema,
} from "@pushdocs/contracts";
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
  if (config.preview) safePath(config.preview.output);
  for (const location of [config.media.images, config.media.video]) {
    if (!location) continue;
    safePath(expand(location.directory, { locale: config.defaultLocale }).replace(/\/+$/, ""));
    mediaPublicUrl(config, config.defaultLocale, location.publicUrl);
  }
  for (const prefix of Object.values(config.media.documentPathPrefixes ?? {}))
    safePath(prefix.replace(/\/+$/, ""));
  return config;
}

export function expand(source: string, values: Record<string, string>): string {
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

export function relativeDocumentPath(config: ProjectConfig, documentPath: string) {
  return documentPath.startsWith("i18n/")
    ? documentPath.replace(
        /^i18n\/[^/]+\/(?:docusaurus-plugin-content-docs[^/]*\/)?(?:current\/|version-[^/]+\/|docs\/)?/,
        "",
      )
    : documentPath.startsWith("versioned_docs/")
      ? documentPath.replace(/^versioned_docs\/version-[^/]+\//, "")
      : documentPath.slice(
          (config.documentRoots
            .filter((root) => documentPath.startsWith(`${root}/`))
            .sort((left, right) => right.length - left.length)[0]?.length ??
            Math.max(-1, documentPath.indexOf("/"))) + 1,
        );
}

export function localMediaUrl(value: string) {
  const url = value.replace(/^pathname:\/\//, "");
  const decoded = decodeURIComponent(url);
  if (
    !url.startsWith("/") ||
    decoded.startsWith("//") ||
    decoded.split("/").some((part) => part === "." || part === "..") ||
    /[\\?#\s]/.test(url) ||
    [...decoded].some(
      (character) =>
        character === "\\" || character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error("URL вложения должен быть локальным");
  return url.replace(/\/+$/, "");
}

export function mediaTemplateValues(config: ProjectConfig, locale: string, documentPath = "") {
  if (!/^[a-zA-Z0-9_-]+$/.test(locale)) throw new Error("Недопустимая локаль вложения");
  let relative = documentPath ? relativeDocumentPath(config, documentPath) : "";
  const prefix = config.media.documentPathPrefixes?.[locale]?.replace(/\/+$/, "");
  if (prefix && relative.startsWith(`${prefix}/`)) relative = relative.slice(prefix.length + 1);
  return {
    locale,
    document: relative.replace(/\.mdx?$/i, ""),
  };
}

/** URL locale segments omit the default locale; repository directory templates retain it. */
export function mediaPublicUrl(config: ProjectConfig, locale: string, template: string) {
  const localized =
    locale === config.defaultLocale ? template.replace(/\/\{locale\}(?=\/|$)/g, "") : template;
  const values = mediaTemplateValues(config, locale);
  return localMediaUrl(expand(localized, { locale: values.locale }) || "/");
}

export function mediaComponentBaseUrl(
  config: ProjectConfig,
  locale: string,
  component: "docmedia" | "video",
) {
  return mediaPublicUrl(
    config,
    locale,
    component === "video"
      ? (config.media.video?.publicUrl ?? defaultMediaLocations.video.publicUrl)
      : (config.media.images?.publicUrl ?? defaultMediaLocations.images.publicUrl),
  );
}

export function attachmentUploadDirectory(
  config: ProjectConfig,
  locale = config.defaultLocale,
  documentPath?: string,
  component?: "docmedia" | "video",
) {
  const values = mediaTemplateValues(config, locale, documentPath);
  const componentDirectory =
    component === "video" ? config.media.video?.directory : config.media.images?.directory;
  const template =
    componentDirectory ?? config.media.images?.directory ?? defaultMediaLocations.images.directory;
  const base = safePath(expand(template, values).trim().replace(/\/+$/, ""));
  if (!documentPath) return base;
  return safePath(`${base}/${values.document}`);
}

export function isEditableFile(config: ProjectConfig, filePath: string): boolean {
  safePath(filePath);
  return (
    filePath === ".pushdocs/config.json" ||
    filePath.endsWith("/.gitkeep") ||
    config.editableFiles.includes(filePath) ||
    /\.(mdx?|json)$/i.test(filePath)
  );
}

export function assertProjectFileEditable(
  config: ProjectConfig,
  filePath: string,
  role: string,
): void {
  safePath(filePath);
  if (!isEditableFile(config, filePath)) throw new Error("Файл не разрешён настройками проекта");
  if (filePath === ".pushdocs/config.json" && role !== "admin")
    throw new Error("Конфигурацию изменяет администратор");
}
