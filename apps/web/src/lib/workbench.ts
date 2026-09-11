import "server-only";
import { isEditableFile, parseProjectConfig, safePath } from "@pushdocs/content";
import { providerForConnection } from "./provider";
import { repository, requireUser } from "./server";

export async function workbenchContext(projectId: string, branch: string) {
  const user = await requireUser();
  const store = repository();
  const access = await store.requireProjectAccess(user.id, projectId);
  const target = await store.getProjectSyncTarget(projectId);
  if (!target) throw new Error("Подключение проекта недоступно");
  const state = await store.listWorkingFiles(projectId, branch);
  const configFile = state.files.find(
    (file) => file.path === ".pushdocs/config.json" && file.status !== "delete",
  );
  const config = parseProjectConfig(configFile?.content);
  const provider = await providerForConnection(target);
  return { user, store, access, target, state, config, provider };
}

export function assertEditable(
  config: ReturnType<typeof parseProjectConfig>,
  path: string,
  role: string,
): void {
  safePath(path);
  if (!isEditableFile(config, path)) throw new Error("Файл не разрешён настройками проекта");
  if (path === ".pushdocs/config.json" && role !== "admin")
    throw new Error("Конфигурацию изменяет администратор");
}

export function assertSameOrigin(request: Request): void {
  const origin = request.headers.get("origin");
  const expected = process.env.PUSHDOCS_PUBLIC_ORIGIN ?? new URL(request.url).origin;
  if (!origin || origin !== expected) throw new Error("Недопустимый источник запроса");
}

export function apiError(error: unknown): Response {
  const message = error instanceof Error ? error.message : "Не удалось выполнить операцию";
  if (message === "NEXT_REDIRECT")
    return Response.json({ error: "Сессия истекла. Войдите заново." }, { status: 401 });
  const code = error && typeof error === "object" && "code" in error ? error.code : "";
  return Response.json(
    { error: message },
    { status: code === "REVISION_CONFLICT" ? 409 : code === "ACCESS_DENIED" ? 403 : 400 },
  );
}
