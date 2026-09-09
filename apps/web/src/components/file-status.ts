export const fileStatusLabel: Record<string, string> = {
  add: "Новый файл",
  modify: "Изменён",
  delete: "Удалён",
};
export function mergeFileStatuses(
  branch: Record<string, string>,
  drafts: Array<{ path: string; status: string }>,
) {
  const statuses = new Map(Object.entries(branch));
  for (const file of drafts) {
    if (file.status === "clean") continue;
    statuses.set(
      file.path,
      file.status === "modify" && statuses.get(file.path) === "add" ? "add" : file.status,
    );
  }
  return statuses;
}
export function changedDirectories(statuses: Map<string, string>) {
  const directories = new Set<string>();
  for (const [path, status] of statuses) {
    if (!fileStatusLabel[status]) continue;
    const parts = path.split("/");
    for (let index = 1; index < parts.length; index++)
      directories.add(parts.slice(0, index).join("/"));
  }
  return directories;
}
