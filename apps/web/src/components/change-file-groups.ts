export enum ChangeFileKind {
  Article = "article",
  Image = "image",
  Other = "other",
}

export type ChangeFileGroup<T> = {
  kind: ChangeFileKind;
  label: string;
  files: T[];
};

const groupLabels = {
  [ChangeFileKind.Article]: "Статьи",
  [ChangeFileKind.Image]: "Изображения",
  [ChangeFileKind.Other]: "Другие файлы",
};
const pathCollator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });

export function changeFileKind(path: string) {
  return /\.(md|mdx)$/i.test(path)
    ? ChangeFileKind.Article
    : /\.(png|jpe?g|gif|webp|avif|svg)$/i.test(path)
      ? ChangeFileKind.Image
      : ChangeFileKind.Other;
}

export function groupChangedFiles<T extends { path: string }>(files: readonly T[]) {
  const groups: Record<ChangeFileKind, T[]> = {
    [ChangeFileKind.Article]: [],
    [ChangeFileKind.Image]: [],
    [ChangeFileKind.Other]: [],
  };
  for (const file of files) {
    groups[changeFileKind(file.path)].push(file);
  }
  return Object.values(ChangeFileKind)
    .map(
      (kind): ChangeFileGroup<T> => ({
        kind,
        label: groupLabels[kind],
        files: groups[kind].sort((left, right) => pathCollator.compare(left.path, right.path)),
      }),
    )
    .filter((group) => group.files.length > 0);
}
