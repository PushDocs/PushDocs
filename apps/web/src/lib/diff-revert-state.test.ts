import { expect, it } from "vitest";
import { buildTextDiff, revertDiffLines } from "@/components/text-diff";
import { applyRevertEdits, revertEdits, textEdits } from "./diff-revert-state";

it.each([
  ["A\nB\nC\n", "D\nE\nF\n", "D\nB\nF\n", "A\nB\nF\n", "A\nE\nF\n"],
  ["A\r\nB\r\nC\r\n", "D\r\nE\r\nF\r\n", "D\r\nB\r\nF\r\n", "A\r\nB\r\nF\r\n", "A\r\nE\r\nF\r\n"],
  ["A\r\nB\nC", "D\r\nE\r\nF", "D\r\nB\nF", "A\r\nB\nF", "A\r\nE\r\nF"],
])(
  "restores a middle pair in place while preserving a later rollback: %j",
  (base, prior, rolledBack, current, restored) => {
    const diff = buildTextDiff(base, prior);
    if (!diff) throw new Error("No diff");
    const edits = revertEdits(diff.lines, [1, 4]);
    expect(edits).toEqual([
      {
        start: rolledBack.indexOf("B"),
        end: rolledBack.indexOf("F"),
        text: prior.slice(prior.indexOf("E"), prior.indexOf("F")),
      },
    ]);
    expect(revertDiffLines(base, prior, [1, 4])).toBe(rolledBack);
    expect(applyRevertEdits(rolledBack, rolledBack, true, edits)).toBe(prior);
    expect(applyRevertEdits(rolledBack, current, true, edits)).toBe(restored);
  },
);

it("undoes the first rollback without undoing a later independent block", () => {
  const base = "old A\nkeep\nold B\n";
  const prior = "new A\nkeep\nnew B\n";
  const diff = buildTextDiff(base, prior);
  if (!diff) throw new Error("No diff");
  const first = revertDiffLines(base, prior, [0, 1]);
  const edits = revertEdits(diff.lines, [0, 1]);
  expect(applyRevertEdits(first, base, true, edits)).toBe("new A\nkeep\nold B\n");
});
it("restores nonadjacent pairs independently within one replacement block", () => {
  const base = "A\nB\nC\n";
  const prior = "D\nE\nF\n";
  const diff = buildTextDiff(base, prior);
  if (!diff) throw new Error("No diff");
  const rolledBack = revertDiffLines(base, prior, [0, 2, 3, 5]);
  const edits = revertEdits(diff.lines, [0, 2, 3, 5]);
  expect(edits).toEqual([
    { start: 0, end: 2, text: "D\n" },
    { start: 4, end: 6, text: "F\n" },
  ]);
  const current = applyRevertEdits(rolledBack, rolledBack, true, [
    edits[1] as NonNullable<(typeof edits)[1]>,
  ]);
  expect(current).toBe("A\nE\nF\n");
  expect(
    applyRevertEdits(rolledBack, current, true, [edits[0] as NonNullable<(typeof edits)[0]>]),
  ).toBe(prior);
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
