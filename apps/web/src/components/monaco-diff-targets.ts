import type { editor } from "monaco-editor";
import { type DiffLine, diffHunks, revertDiffLines } from "./text-diff";

const normalize = (value: string) => value.replace(/\r\n?/g, "\n");
export function deletedModelLines(
  zone: Element,
  model: editor.ITextModel,
  change: editor.ILineChange,
) {
  const mapping = new Map<Element, number>();
  let line = change.originalStartLineNumber;
  let text = "";
  for (const row of zone.querySelectorAll(".view-line")) {
    if (line > change.originalEndLineNumber) return undefined;
    mapping.set(row, line);
    text += row.textContent ?? "";
    const actual = text.replace(/\s/g, "");
    const expected = model.getLineContent(line).replace(/\s/g, "");
    if (!expected.startsWith(actual)) return undefined;
    if (actual === expected) {
      line++;
      text = "";
    }
  }
  return line === change.originalEndLineNumber + 1 && !text ? mapping : undefined;
}

export function equivalentDiffTarget(
  before: string,
  after: string,
  lines: DiffLine[],
  change: editor.ILineChange,
) {
  const original = normalize(before).split("\n");
  const modified = normalize(after).split("\n");
  const start =
    change.modifiedEndLineNumber === 0
      ? change.modifiedStartLineNumber
      : change.modifiedStartLineNumber - 1;
  const end = change.modifiedEndLineNumber === 0 ? start : change.modifiedEndLineNumber;
  const expected = [
    ...modified.slice(0, start),
    ...original.slice(change.originalStartLineNumber - 1, change.originalEndLineNumber),
    ...modified.slice(end),
  ].join("\n");
  let oldStart = change.originalStartLineNumber;
  let oldEnd = change.originalEndLineNumber;
  while (oldStart > 1 && !original[oldStart - 2]?.trim()) oldStart--;
  while (oldEnd < original.length && !original[oldEnd]?.trim()) oldEnd++;
  const overlaps = (line: DiffLine) =>
    (line.oldNumber !== undefined && line.oldNumber >= oldStart && line.oldNumber <= oldEnd) ||
    (change.modifiedEndLineNumber > 0 &&
      line.newNumber !== undefined &&
      line.newNumber >= change.modifiedStartLineNumber &&
      line.newNumber <= change.modifiedEndLineNumber);
  const hunks = diffHunks(lines).filter((hunk) => hunk.lines.some(overlaps));
  for (const ids of [
    hunks.flatMap((hunk) => hunk.lines.map((line) => line.id)),
    lines.filter((line) => line.kind !== "context" && overlaps(line)).map((line) => line.id),
  ]) {
    if (ids.length && normalize(revertDiffLines(before, after, ids)) === expected)
      return { lineIds: [], hunkIds: ids, line: hunks[0]?.modifiedLine ?? start + 1 };
  }
  return undefined;
}
