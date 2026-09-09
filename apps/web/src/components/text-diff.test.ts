import { describe, expect, it } from "vitest";
import { buildTextDiff, foldDiff, pairDiffLines } from "./text-diff";

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
});
