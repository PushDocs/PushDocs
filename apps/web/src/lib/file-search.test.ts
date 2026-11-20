import { expect, it } from "vitest";
import { fileSearchPattern } from "./file-search";

it.each([
  {
    query: "письмо",
    text: "Письмо письмом письмо_1 (письмо), письмо.",
    wholeWord: true,
    matchCase: false,
    matches: ["Письмо", "письмо", "письмо"],
  },
  {
    query: "письмо",
    text: "Письмо письмо письмом",
    wholeWord: false,
    matchCase: true,
    matches: ["письмо", "письмо"],
  },
  {
    query: "письмо",
    text: "Письмо письмо письмом",
    wholeWord: true,
    matchCase: true,
    matches: ["письмо"],
  },
  {
    query: "test",
    text: "test tests _test test1 test-тест",
    wholeWord: true,
    matchCase: false,
    matches: ["test", "test"],
  },
  {
    query: "a+b (test)",
    text: "A+B (TEST) a+b (test)",
    wholeWord: false,
    matchCase: false,
    matches: ["A+B (TEST)", "a+b (test)"],
  },
])(
  "matches literal text with case and Unicode word options: $query / $matchCase / $wholeWord",
  ({ query, text, matchCase, wholeWord, matches }) => {
    const pattern = fileSearchPattern(query, { matchCase, wholeWord });
    expect(Array.from(text.matchAll(pattern as RegExp), (match) => match[0])).toEqual(matches);
  },
);

it("keeps offsets in the original text and ignores blank queries", () => {
  expect(fileSearchPattern("test")?.exec("İ TEST")?.index).toBe(2);
  expect(fileSearchPattern("  ")).toBeUndefined();
});
