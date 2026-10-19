import { z } from "zod";

const locale = z.string().regex(/^[a-zA-Z0-9_-]+$/);
const directory = z.string().min(1).max(900);
const publicUrl = z.string().min(1).max(1000);
const prefixes = z.record(locale, directory);
const location = (url: string) =>
  z.object({ directory, publicUrl: publicUrl.default(url) }).strict();

/** Repository configuration describes storage; gallery groups and fallbacks are automatic. */
export const mediaConfigSchema = z
  .object({
    images: location("/{locale}/img").optional(),
    video: location("/{locale}/video").optional(),
    documentPathPrefixes: prefixes.optional(),
  })
  .strict()
  .default({});
