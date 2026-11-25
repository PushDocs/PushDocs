import { buildTextDiff, type DiffLine, diffLinesInPairOrder } from "@/components/text-diff";

export interface RevertEdit {
  start: number;
  end: number;
  text: string;
}
export interface RevertedBlock {
  id: string;
  index: number;
  start: number;
  end: number;
}
export const revertConflictMessage =
  "Фрагмент изменился. Не удалось вернуть изменения без потери более свежих правок.";
const bytes = (line: DiffLine) =>
  line.text + (line.ending === "LF" ? "\n" : line.ending === "CRLF" ? "\r\n" : "");

// Inverse edits are measured in the result of the canonical rollback, including
// empty ranges for removed additions. No second diff can relocate blank lines.
export function revertEdits(lines: DiffLine[], selectedIds: number[]): RevertEdit[] {
  const selected = new Set(selectedIds);
  const edits: RevertEdit[] = [];
  let offset = 0;
  let edit: RevertEdit | undefined;
  for (const line of diffLinesInPairOrder(lines)) {
    const value = bytes(line);
    if (line.kind !== "context" && selected.has(line.id)) {
      edit ??= { start: offset, end: offset, text: "" };
      if (line.kind === "add") edit.text += value;
      else {
        offset += value.length;
        edit.end = offset;
      }
    } else if (line.kind !== "delete") {
      if (edit) {
        edits.push(edit);
        edit = undefined;
      }
      offset += value.length;
    }
  }
  if (edit) edits.push(edit);
  return edits;
}

export function textEdits(from: string, to: string): RevertEdit[] {
  const diff = buildTextDiff(from, to);
  if (!diff) throw new Error(revertConflictMessage);
  return revertEdits(
    diff.lines,
    diff.lines.filter((line) => line.kind !== "context").map((line) => line.id),
  );
}

export function moveRevertRange(range: { start: number; end: number }, changes: RevertEdit[]) {
  let shift = 0;
  for (const change of changes) {
    const overlaps =
      range.start === range.end && change.start === change.end
        ? range.start === change.start
        : range.start === range.end
          ? change.start < range.start && change.end > range.start
          : change.start === change.end
            ? change.start > range.start && change.start < range.end
            : change.start < range.end && change.end > range.start;
    if (overlaps) return undefined;
    if (change.end <= range.start) shift += change.text.length - (change.end - change.start);
  }
  return { start: range.start + shift, end: range.end + shift };
}

export function applyRevertEdits(
  after: string | null,
  current: string | null,
  priorExists: boolean,
  edits: RevertEdit[],
) {
  if ((after === null && current !== null) || (!priorExists && after !== current))
    throw new Error(revertConflictMessage);
  const source = after ?? "";
  const value = current ?? "";
  const changes = source === value ? [] : textEdits(source, value);
  const moved = edits.map((edit) => {
    const range = moveRevertRange(edit, changes);
    if (!range || source.slice(edit.start, edit.end) !== value.slice(range.start, range.end))
      throw new Error(revertConflictMessage);
    return { ...range, text: edit.text };
  });
  let result = value;
  for (const edit of moved.sort((a, b) => b.start - a.start))
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return priorExists ? result : null;
}
