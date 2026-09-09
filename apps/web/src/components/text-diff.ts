import { diffLines } from "diff";

export interface DiffLine {
  id: number;
  kind: "context" | "add" | "delete";
  text: string;
  oldNumber?: number;
  newNumber?: number;
  ending: "LF" | "CRLF" | "none";
}
export type DiffBlock =
  | { kind: "lines"; lines: DiffLine[] }
  | { kind: "fold"; id: number; lines: DiffLine[] };

export function buildTextDiff(before: string, after: string) {
  if (
    before.length + after.length > 2_000_000 ||
    (before.match(/\n/g)?.length ?? 0) + (after.match(/\n/g)?.length ?? 0) > 20000
  )
    return null;
  const changes = diffLines(before, after, { timeout: 200, maxEditLength: 10000 });
  if (!changes) return null;
  let oldNumber = 1;
  let newNumber = 1;
  let added = 0;
  let deleted = 0;
  const lines: DiffLine[] = [];
  for (const change of changes) {
    for (const value of change.value.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
      const kind = change.added ? "add" : change.removed ? "delete" : "context";
      lines.push({
        id: lines.length,
        kind,
        text: value.replace(/\r?\n$/, ""),
        oldNumber: kind === "add" ? undefined : oldNumber++,
        newNumber: kind === "delete" ? undefined : newNumber++,
        ending: value.endsWith("\r\n") ? "CRLF" : value.endsWith("\n") ? "LF" : "none",
      });
      if (kind === "add") added++;
      if (kind === "delete") deleted++;
    }
  }
  return { lines, added, deleted };
}

export function foldDiff(lines: DiffLine[], context = 3): DiffBlock[] {
  const blocks: DiffBlock[] = [];
  let start = 0;
  while (start < lines.length) {
    const unchanged = lines[start]?.kind === "context";
    let end = start + 1;
    while (end < lines.length && (lines[end]?.kind === "context") === unchanged) end++;
    const keepStart = start === 0 ? 0 : context;
    const keepEnd = end === lines.length ? 0 : context;
    if (unchanged && end - start > keepStart + keepEnd + 1) {
      if (keepStart) blocks.push({ kind: "lines", lines: lines.slice(start, start + keepStart) });
      blocks.push({
        kind: "fold",
        id: start,
        lines: lines.slice(start + keepStart, end - keepEnd),
      });
      if (keepEnd) blocks.push({ kind: "lines", lines: lines.slice(end - keepEnd, end) });
    } else {
      blocks.push({ kind: "lines", lines: lines.slice(start, end) });
    }
    start = end;
  }
  return blocks;
}

export function pairDiffLines(lines: DiffLine[]) {
  const rows: { left?: DiffLine; right?: DiffLine }[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line?.kind === "context") {
      rows.push({ left: line, right: line });
      index++;
      continue;
    }
    const removed: DiffLine[] = [];
    const added: DiffLine[] = [];
    while (index < lines.length && lines[index]?.kind !== "context") {
      const changed = lines[index++];
      if (changed) (changed.kind === "delete" ? removed : added).push(changed);
    }
    for (let i = 0; i < Math.max(removed.length, added.length); i++) {
      rows.push({ left: removed[i], right: added[i] });
    }
  }
  return rows;
}
