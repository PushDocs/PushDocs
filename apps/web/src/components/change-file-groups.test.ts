import { expect, it } from "vitest";
import { ChangeFileKind, changeFileKind, groupChangedFiles } from "./change-file-groups";

it.each(["md", "mdx", "MD", "MDX"])(
  "recognizes %s articles in any project directory",
  (extension) => {
    expect(changeFileKind(`custom/content/article.${extension}`)).toBe(ChangeFileKind.Article);
  },
);

it.each(["png", "jpg", "jpeg", "gif", "webp", "avif", "svg", "PNG", "SVG"])(
  "recognizes %s images in any project directory",
  (extension) => {
    expect(changeFileKind(`custom/assets/example.${extension}`)).toBe(ChangeFileKind.Image);
  },
);

it.each([
  "file.pdf",
  "file.zip",
  "file.mp4",
  "config.json",
  "file.txt",
  "README",
  "image.png.md.bak",
])("keeps %s in other files", (path) => {
  expect(changeFileKind(path)).toBe(ChangeFileKind.Other);
});

it("groups and naturally sorts paths without changing the input or losing file data", () => {
  const files = [
    { path: "assets/b.svg", operation: "delete" },
    { path: "content/file-10.md", operation: "modify" },
    { path: "settings.json", operation: "modify" },
    { path: "content/file-2.mdx", operation: "add" },
    { path: "assets/a.PNG", operation: "add" },
  ];
  const original = [...files];
  expect(groupChangedFiles(files)).toEqual([
    { kind: ChangeFileKind.Article, label: "Статьи", files: [files[3], files[1]] },
    { kind: ChangeFileKind.Image, label: "Изображения", files: [files[4], files[0]] },
    { kind: ChangeFileKind.Other, label: "Другие файлы", files: [files[2]] },
  ]);
  expect(files).toEqual(original);
});

it("omits empty groups", () => {
  expect(groupChangedFiles([])).toEqual([]);
  expect(groupChangedFiles([{ path: "custom/a.svg" }]).map((group) => group.label)).toEqual([
    "Изображения",
  ]);
});
