import { z } from "zod";

export enum MediaInsertionMode {
  Library = "library",
  Markdown = "markdown",
  Images = "images",
  Video = "video",
}

export const defaultMediaLocations = {
  images: { directory: "static/img", publicUrl: "/{locale}/img" },
  video: { directory: "static/video", publicUrl: "/{locale}/video" },
} as const;

const locale = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const directory = z.string().min(1).max(900);
const publicUrl = z.string().min(1).max(1000);
const prefixes = z.record(locale, directory);
const location = (url: string) =>
  z.object({ directory, publicUrl: publicUrl.default(url) }).strict();

const mediaComponentSchema = z
  .object({ storage: z.enum(["images", "video"]), srcBase: publicUrl.optional() })
  .strict();
export type MediaComponentConfig = z.infer<typeof mediaComponentSchema>;

/** Repository configuration describes storage; gallery groups and fallbacks are automatic. */
export const mediaConfigSchema = z
  .object({
    images: location(defaultMediaLocations.images.publicUrl).optional(),
    video: location(defaultMediaLocations.video.publicUrl).optional(),
    documentPathPrefixes: prefixes.optional(),
    components: z.record(z.string().regex(/^[A-Z]\w*$/), mediaComponentSchema).default({}),
  })
  .strict()
  .default({ components: {} });
