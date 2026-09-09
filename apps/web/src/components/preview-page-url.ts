import { readMetadata } from "@pushdocs/content/metadata";

/** Resolve the standard docs plugin's static routing configuration without evaluating repository code. */
export function articleRoute(
  path: string,
  source: string,
  configuration: string,
): string | undefined {
  const stringOption = (name: string, fallback: string) => {
    if (!new RegExp(`\\b${name}\\s*:`).test(configuration)) return fallback;
    return configuration.match(new RegExp(`\\b${name}\\s*:\\s*(['"\\x60])([^'"\\x60$]*)\\1`))?.[2];
  };
  const base = stringOption("baseUrl", "/");
  const route = stringOption("routeBasePath", "docs");
  if (base === undefined || route === undefined || !base.startsWith("/") || base.startsWith("//"))
    return;
  let relative = path.replace(/^docs\//, "");
  let locale = "";
  const translated = path.match(/^i18n\/([^/]+)\/docusaurus-plugin-content-docs\/current\/(.+)$/);
  if (translated?.[1] && translated[2]) {
    locale = translated[1];
    relative = translated[2];
  } else if (!path.startsWith("docs/")) return;
  let slug: unknown;
  try {
    slug = readMetadata(source).values.slug;
  } catch {
    return;
  }
  const parts = relative
    .replace(/\.mdx?$/i, "")
    .split("/")
    .map((part) => part.replace(/^\d+[-_]/, ""));
  if (/^(index|readme)$/i.test(parts.at(-1) ?? "") || parts.at(-1) === parts.at(-2)) parts.pop();
  const doc =
    typeof slug === "string"
      ? slug.startsWith("/")
        ? slug
        : [...relative.split("/").slice(0, -1), slug].join("/")
      : parts.join("/");
  const result = [base, locale, route, doc].join("/").split("/").filter(Boolean);
  if (result.some((part) => part === ".." || part === "." || /[?#\\]/.test(part))) return;
  return `/${result.map(encodeURIComponent).join("/")}`;
}
export function previewPageUrl(buildUrl: string, route?: string) {
  if (!route) return buildUrl;
  const url = new URL(buildUrl);
  url.pathname = route;
  return url.toString();
}
