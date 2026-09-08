import type { ProjectConfig } from "@pushdocs/contracts";
import { assetLocation } from "./config";

export const isMediaFile = (filePath: string) =>
  /\.(png|jpe?g|gif|webp|avif|svg|pdf|zip|csv|txt|mp4)$/i.test(filePath);

export function mediaCatalog(input: {
  config: ProjectConfig;
  locale: string;
  document: string;
  paths: string[];
  files: Array<{ path: string; content: string; status: string }>;
  uploads: Array<{ path: string; size: number }>;
}) {
  const location = assetLocation(input.config, input.locale, input.document, "placeholder");
  const directory = location.path.slice(0, location.path.lastIndexOf("/") + 1);
  const urlRoot = location.url.slice(0, location.url.lastIndexOf("/") + 1);
  const uploads = new Map(input.uploads.map((file) => [file.path, file.size]));
  const deleted = new Set(
    input.files.filter((file) => file.status === "delete").map((file) => file.path),
  );
  return [...new Set([...input.paths, ...uploads.keys()])]
    .filter(isMediaFile)
    .sort()
    .map((filePath) => {
      const name = filePath.split("/").at(-1) ?? filePath;
      return {
        path: filePath,
        url: filePath.startsWith(directory)
          ? urlRoot + filePath.slice(directory.length).split("/").map(encodeURIComponent).join("/")
          : null,
        status: deleted.has(filePath) ? "delete" : uploads.has(filePath) ? "upload" : "clean",
        size: uploads.get(filePath) ?? null,
        // This is an intentionally conservative candidate list, not a JavaScript/MDX evaluator.
        usages: input.files
          .filter(
            (file) =>
              file.status !== "delete" &&
              (file.content.includes(name) || file.content.includes(encodeURIComponent(name))),
          )
          .map((file) => file.path),
      };
    });
}
