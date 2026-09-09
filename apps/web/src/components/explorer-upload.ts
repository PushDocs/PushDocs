import { isEditableFile, safePath } from "@pushdocs/content/config";
import type { ProjectConfig } from "@pushdocs/contracts";

interface Snapshot {
  revision: number;
  config: ProjectConfig;
  repositoryPaths: string[];
  files: Array<{ path: string }>;
  uploads?: Array<{ path: string }>;
}

export async function uploadExplorerFiles({
  files,
  directory,
  projectId,
  branch,
  reload,
  onProgress,
}: {
  files: File[];
  directory: string;
  projectId: string;
  branch: string;
  reload: () => Promise<Snapshot>;
  onProgress: (message: string) => void;
}) {
  const uploaded: string[] = [];
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      const path = safePath(directory ? `${directory}/${file.name}` : file.name);
      if (file.name.includes("/")) throw new Error("Перетащите отдельные файлы");
      onProgress(`Загрузка ${index + 1}/${files.length}: ${file.name}`);
      const state = await reload();
      const occupied = [
        ...state.repositoryPaths,
        ...state.files.map((item) => item.path),
        ...(state.uploads ?? []).map((item) => item.path),
      ];
      if (
        occupied.some(
          (item) => item === path || item.startsWith(`${path}/`) || path.startsWith(`${item}/`),
        )
      )
        throw new Error("Путь уже занят. Переименуйте файл перед загрузкой.");
      let response: Response;
      if (isEditableFile(state.config, path)) {
        if (file.size > 1_000_000) throw new Error("Текстовый файл превышает лимит 1 МБ");
        const content = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
          await file.arrayBuffer(),
        );
        if (content.includes("\0")) throw new Error("Ожидается текстовый файл UTF-8");
        response = await fetch(`/api/projects/${projectId}/workbench`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "files",
            branch,
            expectedRevision: state.revision,
            files: [{ path, content, createOnly: true }],
          }),
        });
      } else {
        if (file.size > 64 * 1024 * 1024) throw new Error("Файл превышает лимит 64 МиБ");
        const query = new URLSearchParams({
          branch,
          path,
          name: file.name,
          revision: String(state.revision),
          destination: "repository",
        });
        response = await fetch(`/api/projects/${projectId}/assets?${query}`, {
          method: "POST",
          body: file,
        });
      }
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Не удалось загрузить файл");
      uploaded.push(path);
    } catch (error) {
      errors.push(`${file.name}: ${error instanceof Error ? error.message : "Ошибка загрузки"}`);
    }
  }
  await reload();
  return { uploaded, errors };
}
