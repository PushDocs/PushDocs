import { describe, expect, it } from "vitest";
import { buildTextDiff, diffHunks, foldDiff, pairDiffLines, revertDiffLines } from "./text-diff";

describe("text diff", () => {
  it("numbers insertions and deletions independently and aligns replacements", () => {
    const result = buildTextDiff("a\nb\nc\n", "a\nx\ny\nc\n");
    expect(result).toMatchObject({ added: 2, deleted: 1 });
    expect(
      result?.lines.map(({ kind, oldNumber, newNumber }) => [kind, oldNumber, newNumber]),
    ).toEqual([
      ["context", 1, 1],
      ["delete", 2, undefined],
      ["add", undefined, 2],
      ["add", undefined, 3],
      ["context", 3, 4],
    ]);
    const pairs = pairDiffLines(result?.lines ?? []);
    expect(pairs.map(({ left, right }) => [left?.text, right?.text])).toEqual([
      ["a", "a"],
      ["b", "x"],
      [undefined, "y"],
      ["c", "c"],
    ]);
  });

  it.each([
    ["", ""],
    ["", "a\n\n"],
    ["a\n", ""],
    ["a\n", "a"],
    ["a\r\n", "a\n"],
    ["a\nb\na\nb\n", "b\na\nb\na\n"],
    [" a \n", "a\n"],
  ])("reconstructs both revisions exactly: %j → %j", (before, after) => {
    const result = buildTextDiff(before, after);
    expect(result).not.toBeNull();
    const reconstruct = (side: "before" | "after") =>
      result?.lines
        .filter((line) => line.kind !== (side === "before" ? "add" : "delete"))
        .map(
          (line) =>
            line.text + (line.ending === "LF" ? "\n" : line.ending === "CRLF" ? "\r\n" : ""),
        )
        .join("");
    expect(reconstruct("before")).toBe(before);
    expect(reconstruct("after")).toBe(after);
  });

  it("folds only unchanged lines while retaining three context lines near changes", () => {
    const before = Array.from({ length: 40 }, (_, i) => `${i}\n`).join("");
    const result = buildTextDiff(
      before,
      before.replace("10\n", "changed\n").replace("30\n", "also changed\n"),
    );
    const blocks = foldDiff(result?.lines ?? []);
    expect(
      blocks.filter((block) => block.kind === "fold").map((block) => block.lines.length),
    ).toEqual([7, 13, 6]);
    expect(blocks.flatMap((block) => block.lines)).toEqual(result?.lines);
    expect(
      blocks
        .filter((block) => block.kind === "fold")
        .every((block) => block.lines.every((line) => line.kind === "context")),
    ).toBe(true);
  });

  it("bounds the amount of work for very large files", () => {
    expect(buildTextDiff("", "line\n".repeat(20001))).toBeNull();
  });

  it("reverts a replacement without touching other changes or mixed line endings", () => {
    const before = "start\r\nold\nkeep\r\nlast";
    const after = "start\r\nnew\nkeep\r\nchanged";
    const hunks = diffHunks(buildTextDiff(before, after)?.lines ?? []);
    expect(hunks.map((hunk) => hunk.modifiedLine)).toEqual([2, 4]);
    expect(revertDiffLines(before, after, hunks[0]?.lines.map((line) => line.id) ?? [])).toBe(
      "start\r\nold\nkeep\r\nchanged",
    );
  });

  it.each([
    ["A\nB\nC\n", "D\nE\nF\n", [1, 4], "D\nB\nF\n"],
    ["A\nB\nC\n", "D\nE\nF\n", [0, 3], "A\nE\nF\n"],
    ["A\nB\nC\n", "D\nE\nF\n", [2, 5], "D\nE\nC\n"],
    ["A\nB\nC\n", "D\nE\nF\n", [0, 2, 3, 5], "A\nE\nC\n"],
    ["A\nB\nC\n", "D\nE\nF\nG\n", [1, 4], "D\nB\nF\nG\n"],
    ["A\nB\nC\nG\n", "D\nE\nF\n", [1, 5], "D\nB\nF\n"],
    ["A\nB\nC\n", "D\nE\nF\n", [1], "D\nB\nE\nF\n"],
    ["A\nB\nC\n", "D\nE\nF\n", [4], "D\nF\n"],
    ["A\r\nB\nC", "D\r\nE\r\nF", [1, 4], "D\r\nB\nF"],
  ])(
    "keeps a partial replacement in its displayed row: %j → %j",
    (before, after, ids, expected) => {
      expect(revertDiffLines(before, after, ids)).toBe(expected);
    },
  );

  it.each([
    ["", "new\nfile", [0, 1], ""],
    ["deleted\r\nfile", "", [0], "deleted\r\n"],
    ["old\n", "new\n", [0, 1], "old\n"],
    ["a\r\n", "a\n", [0, 1], "a\r\n"],
    ["a\n", "a", [0, 1], "a\n"],
  ])("reverts added/deleted lines and EOF changes: %j → %j", (before, after, ids, expected) => {
    expect(revertDiffLines(before, after, ids)).toBe(expected);
  });

  it.each([[], [0], [1, 1], [99]])(
    "rejects empty, context, duplicate or missing IDs: %j",
    (...ids) => {
      expect(() => revertDiffLines("same\nold\n", "same\nnew\n", ids)).toThrow();
    },
  );
});
