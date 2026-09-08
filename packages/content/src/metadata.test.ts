import { expect, it } from "vitest";
import { patchMetadata, readMetadata } from "./metadata";

it("changes only the selected YAML scalar and preserves comments, unknown fields and MDX bytes", () => {
  const source =
    '\uFEFF---\r\ntitle: "Old" # editor note\r\ncustom:\r\n  nested: [1, 2]\r\n---\r\nimport X from "./x";\r\n<X value={true} /> &#x20;\r\n';
  expect(readMetadata(source).values.title).toBe("Old");
  expect(patchMetadata(source, { title: "Old" })).toBe(source);
  expect(patchMetadata(source, { title: "New: title" })).toBe(
    source.replace('"Old"', '"New: title"'),
  );
  expect(
    patchMetadata("---\ntitle: A # keep\nslug: old\n---\n<Widget />", { title: "B", slug: "new" }),
  ).toBe('---\ntitle: "B" # keep\nslug: "new"\n---\n<Widget />');
  expect(patchMetadata(source, { draft: false, sidebar_position: 2 })).toBe(
    source.replace("---\r\nimport", "draft: false\r\nsidebar_position: 2\r\n---\r\nimport"),
  );
});
it("creates front matter without reserializing the article", () => {
  expect(patchMetadata("# Article\r\n<Widget />", { title: "Article" })).toBe(
    '---\r\ntitle: "Article"\r\n---\r\n# Article\r\n<Widget />',
  );
  expect(patchMetadata("# Article", {})).toBe("# Article");
  expect(patchMetadata("\uFEFF# A", { title: "A" })).toBe('\uFEFF---\ntitle: "A"\n---\n# A');
});
it("leaves complex YAML fields read-only while allowing independent scalar edits", () => {
  const source =
    "---\ntitle: Old\ndescription: |\n  Multiline\n  content\nunknown: &ref Original\ncopy: *ref\n---\n# Body\n";
  expect(readMetadata(source).blocked).toEqual(
    expect.arrayContaining(["description", "unknown", "copy"]),
  );
  expect(patchMetadata(source, { title: "New" })).toBe(
    source.replace("title: Old", 'title: "New"'),
  );
  expect(() => patchMetadata(source, { description: "Changed" })).toThrow("исходник");
});
it.each([
  "---javascript\nglobalThis.bad=true\n---\n# Body",
  "---\ntitle: A\ntitle: B\n---\n",
  "---\n{ title: A }\n---\n",
  "---\n- item\n---\n",
  "---\ntitle: Unclosed",
  "---\nx: !custom value\n---\n",
  "---\n42: value\n---\n",
])("rejects ambiguous or unsupported front matter without execution: %s", (source) => {
  expect(() => readMetadata(source)).toThrow();
});
it("bounds metadata input and validates field names and values", () => {
  expect(() => readMetadata(`---\ntitle: ${"a".repeat(100_001)}\n---\n`)).toThrow("100");
  for (const fields of [{ "bad:name": "x" }, { title: Number.NaN }, { constructor: "x" }] as Array<
    Record<string, string | number>
  >)
    expect(() => patchMetadata("# Body", fields)).toThrow();
});
