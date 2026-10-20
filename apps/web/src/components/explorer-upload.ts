import { isEditableFile, safePath } from "@pushdocs/content/config";
import type { ProjectConfig } from "@pushdocs/contracts";

export type UploadDecision =
  | { action: "replace" }
  | { action: "rename"; name: string }
  | { action: "skip" };

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
  onConflict,
}: {
  files: File[];
  directory: string;
  projectId: string;
  branch: string;
  reload: () => Promise<Snapshot>;
  onProgress: (message: string) => void;
  onConflict?: (path: string) => Promise<UploadDecision>;
}) {
  const uploaded: string[] = [];
  const errors: string[] = [];
  for (const [index, file] of files.entries()) {
    try {
      let path = safePath(directory ? `${directory}/${file.name}` : file.name);
      if (file.name.includes("/")) throw new Error("Перетащите отдельные файлы");
      onProgress(`Загрузка ${index + 1}/${files.length}: ${file.name}`);
      const state = await reload();
      const occupied = [
        ...state.repositoryPaths,
        ...state.files.map((item) => item.path),
        ...(state.uploads ?? []).map((item) => item.path),
      ];
      let replacing = false;
      while (occupied.includes(path)) {
        if (!onConflict) throw new Error("Файл с таким именем уже существует");
        const decision = await onConflict(path);
        if (decision.action === "skip") break;
        if (decision.action === "replace") {
          replacing = true;
          break;
        }
        if (!decision.name || /[/\\]/.test(decision.name))
          throw new Error("Введите имя файла без папок");
        path = safePath(directory ? `${directory}/${decision.name}` : decision.name);
      }
      if (occupied.includes(path) && !replacing) continue;
      if (occupied.some((item) => item.startsWith(`${path}/`) || path.startsWith(`${item}/`)))
        throw new Error("Этот путь занят папкой или другим файлом. Выберите другое имя");
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
            files: [{ path, content, createOnly: !replacing }],
          }),
        });
      } else {
        if (file.size > 64 * 1024 * 1024) throw new Error("Файл превышает лимит 64 МиБ");
        const query = new URLSearchParams({
          branch,
          path,
          name: file.name,
          revision: String(state.revision),
          replace: String(replacing),
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
      errors.push(
        `Не удалось загрузить ${file.name}: ${error instanceof Error ? error.message : "Ошибка загрузки"}`,
      );
    }
  }
  await reload();
  return { uploaded, errors };
}
