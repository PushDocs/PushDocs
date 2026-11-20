export interface FileSearchOptions {
  matchCase: boolean;
  wholeWord: boolean;
}

export const defaultFileSearchOptions: FileSearchOptions = {
  matchCase: false,
  wholeWord: false,
};

export const fileSearchLimits = {
  results: 100,
  excerptBefore: 40,
  excerptAfter: 140,
  requestDelay: 180,
} as const;

/** Literal search with Unicode word boundaries, shared by server results and highlights. */
export function fileSearchPattern(query: string, options = defaultFileSearchOptions) {
  const needle = query.trim();
  if (!needle) return undefined;
  const literal = needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const word = "[\\p{L}\\p{M}\\p{N}_]";
  const pattern = options.wholeWord ? `(?<!${word})${literal}(?!${word})` : literal;
  return new RegExp(pattern, options.matchCase ? "gu" : "giu");
}
