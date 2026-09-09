import { isMap, isScalar, parseDocument } from "yaml";

export type MetadataValue = string | number | boolean;
const unsupported = "Эту конструкцию front matter изменяйте через исходник";

function inspect(source: string) {
  const opening = /^\uFEFF?---[ \t]*\r?\n/.exec(source);
  const bom = source.startsWith("\uFEFF") ? 1 : 0;
  const start = opening?.[0].length ?? bom;
  const closing = opening ? /^---[ \t]*(?:\r?\n|$)/m.exec(source.slice(start)) : null;
  if ((opening && !closing) || (!opening && /^\uFEFF?---/.test(source)))
    throw new Error(unsupported);
  const end = start + (closing?.index ?? 0);
  const yaml = opening ? source.slice(start, end) : "";
  if (yaml.length > 100_000) throw new Error("Front matter превышает 100 КБ");
  const doc = parseDocument(yaml, { schema: "core", logLevel: "silent" });
  if (
    doc.errors.length ||
    doc.warnings.length ||
    (doc.contents && (!isMap(doc.contents) || doc.contents.flow))
  )
    throw new Error(unsupported);
  const fields = new Map<string, { value: MetadataValue; range: [number, number] }>();
  const blocked: string[] = [];
  if (isMap(doc.contents))
    for (const pair of doc.contents.items) {
      if (!isScalar(pair.key) || typeof pair.key.value !== "string") throw new Error(unsupported);
      const node = pair.value;
      const key = pair.key.value;
      if (
        isScalar(node) &&
        node.range &&
        !node.anchor &&
        !node.tag &&
        ["string", "number", "boolean"].includes(typeof node.value) &&
        !(typeof node.value === "number" && !Number.isFinite(node.value)) &&
        !/[\r\n]/.test(yaml.slice(node.range[0], node.range[1]))
      ) {
        fields.set(key, {
          value: node.value as MetadataValue,
          range: [start + node.range[0], start + node.range[1]],
        });
      } else blocked.push(key);
    }
  return { fields, blocked, start, end, hasHeader: Boolean(opening), bom };
}

export function readMetadata(source: string) {
  const parsed = inspect(source);
  return {
    values: Object.fromEntries([...parsed.fields].map(([key, field]) => [key, field.value])),
    blocked: parsed.blocked,
  };
}

/** Remove a scalar override while preserving other YAML, comments and document bytes. */
export function removeMetadata(source: string, key: string): string {
  const parsed = inspect(source);
  if (parsed.blocked.includes(key)) throw new Error(unsupported);
  const field = parsed.fields.get(key);
  if (!field) return source;
  const start = source.lastIndexOf("\n", field.range[0] - 1) + 1;
  const newline = source.indexOf("\n", field.range[1]);
  const end = newline === -1 ? source.length : newline + 1;
  const suffix = source.slice(field.range[1], end);
  const comment = suffix.match(/^[ \t]+(#[^\r\n]*)(\r?\n)?$/);
  return (
    source.slice(0, start) + (comment ? `${comment[1]}${comment[2] ?? ""}` : "") + source.slice(end)
  );
}

/** Patch scalar value ranges only. Never stringify the whole YAML/MDX document. */
export function patchMetadata(source: string, updates: Record<string, MetadataValue>): string {
  const parsed = inspect(source);
  const newline = source.match(/\r\n|\n/)?.[0] ?? "\n";
  const changes: Array<{ start: number; end: number; text: string }> = [];
  const added: string[] = [];
  for (const [key, value] of Object.entries(updates)) {
    if (
      !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(key) ||
      ["constructor", "prototype"].includes(key) ||
      !["string", "number", "boolean"].includes(typeof value) ||
      (typeof value === "number" && !Number.isFinite(value))
    )
      throw new Error("Недопустимое поле метаданных");
    if (parsed.blocked.includes(key)) throw new Error(unsupported);
    const existing = parsed.fields.get(key);
    if (existing?.value === value) continue;
    const rendered = JSON.stringify(value);
    if (existing)
      changes.push({ start: existing.range[0], end: existing.range[1], text: rendered });
    else added.push(`${key}: ${rendered}${newline}`);
  }
  if (added.length)
    changes.push({
      start: parsed.end,
      end: parsed.end,
      text: parsed.hasHeader ? added.join("") : `---${newline}${added.join("")}---${newline}`,
    });
  let result = source;
  for (const change of changes.sort((a, b) => b.start - a.start))
    result = result.slice(0, change.start) + change.text + result.slice(change.end);
  return result;
}
