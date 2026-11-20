import { expect, it } from "vitest";
import { conflictMarkerSize, parseConflictSections } from "./conflict-sections";

it("preserves a literal final carriage return while removing Git's synthetic newline", () => {
  const originals = { ours: "Ours\r", base: "Base\r", theirs: "Theirs\r" };
  const size = conflictMarkerSize(Object.values(originals));
  const merged = `${"<".repeat(size)} ours\nOurs\r\n${"|".repeat(size)} base\nBase\r\n${"=".repeat(size)}\nTheirs\r\n${">".repeat(size)} theirs\n`;
  expect(parseConflictSections(merged, size, originals)).toEqual([
    { kind: "conflict", ...originals },
  ]);
});

it.each([
  "<<<<<<< ours\nOurs\n",
  "=======\nTheirs\n>>>>>>> theirs\n",
  "Ordinary text without conflict markers\n",
])("rejects incomplete or unrecognized conflict output", (merged) => {
  expect(() =>
    parseConflictSections(merged, 7, { ours: "Ours\n", base: "Base\n", theirs: "Theirs\n" }),
  ).toThrow();
});
