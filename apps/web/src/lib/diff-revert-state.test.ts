import { expect, it } from "vitest";
import { buildTextDiff, revertDiffLines } from "@/components/text-diff";
import { applyRevertEdits, revertEdits, textEdits } from "./diff-revert-state";

it("undoes the first rollback without undoing a later independent block", () => {
  const base = "old A\nkeep\nold B\n";
  const prior = "new A\nkeep\nnew B\n";
  const diff = buildTextDiff(base, prior);
  if (!diff) throw new Error("No diff");
  const first = revertDiffLines(base, prior, [0, 1]);
  const edits = revertEdits(diff.lines, [0, 1]);
  expect(applyRevertEdits(first, base, true, edits)).toBe("new A\nkeep\nold B\n");
});
it("splits a full rollback into independently recoverable blocks and preserves CRLF", () => {
  const base = "old A\r\nkeep\r\nold B\r\n";
  const prior = "new A\r\nkeep\r\nnew B\r\n";
  const edits = textEdits(base, prior);
  expect(edits).toHaveLength(2);
  const partial = applyRevertEdits(base, base, true, [edits[1] as NonNullable<(typeof edits)[1]>]);
  expect(partial).toBe("old A\r\nkeep\r\nnew B\r\n");
  expect(applyRevertEdits(base, partial, true, [edits[0] as NonNullable<(typeof edits)[0]>])).toBe(
    prior,
  );
});
it("does not overwrite intersecting edits or confuse an empty file with deletion", () => {
  const edits = textEdits("old\n", "new\n");
  expect(() => applyRevertEdits("old\n", "external\n", true, edits)).toThrow();
  expect(applyRevertEdits(null, null, true, [{ start: 0, end: 0, text: "new\n" }])).toBe("new\n");
  expect(applyRevertEdits("text", "text", false, [{ start: 0, end: 4, text: "" }])).toBeNull();
  expect(applyRevertEdits("text", "text", true, [{ start: 0, end: 4, text: "" }])).toBe("");
  expect(() =>
    applyRevertEdits(null, "other", true, [{ start: 0, end: 0, text: "new" }]),
  ).toThrow();
});
