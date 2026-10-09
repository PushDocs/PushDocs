import { z } from "zod";
import { previewSettings } from "@/lib/preview-settings";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };

const commandSchema = z.object({
  action: z.enum(["acquire", "heartbeat", "release"]),
  branch: z.string().min(1).max(255),
  clientId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
});

function previewResponse(session: {
  id: string;
  last_error: string | null;
  log: string;
  port: number;
  status: string;
}) {
  const message = session.log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 240);
  return {
    sessionId: session.id,
    status: session.status,
    error: session.last_error,
    log: session.log,
    message,
    waitingForCapacity:
      session.status === "queued" && session.log.startsWith("Ожидаем свободное место"),
    url: `http://${previewSettings().host}:${session.port}/`,
  };
}

export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const branch = new URL(request.url).searchParams.get("branch") ?? "";
    const store = repository();
    await store.requireProjectAccess(user.id, projectId, "project:read");
    const inventory = await store.listPreviewInventory(projectId);
    const workspace = inventory.find((item) => item.branch === branch);
    if (workspace?.deleted || workspace?.delete_requested)
      return Response.json(
        {
          status: "failed",
          error: "Предпросмотр удалён администратором или очищен. Запустите его снова.",
        },
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    const session = await store.getPreviewSession(projectId, branch);
    return Response.json(session ? previewResponse(session) : { status: "stopped" }, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const command = commandSchema.parse(await readJsonBody(request));
    const store = repository();
    await store.requireProjectAccess(user.id, projectId, "project:read");
    if (command.action === "acquire") {
      await store.getBranchState(projectId, command.branch);
      const { portFrom, portTo } = previewSettings();
      const session = await store.acquirePreview({
        branch: command.branch,
        clientId: command.clientId,
        portFrom,
        portTo,
        projectId,
        userId: user.id,
      });
      return Response.json(previewResponse(session));
    }
    if (!command.sessionId) throw new Error("Сессия предпросмотра не указана");
    const current = await store.getPreviewSession(projectId, command.branch);
    if (!current || current.id !== command.sessionId)
      throw new Error("Сессия предпросмотра не найдена");
    if (command.action === "heartbeat") {
      const active = await store.heartbeatPreview(command.sessionId, user.id, command.clientId);
      if (!active) throw new Error("Сессия предпросмотра завершена");
    } else {
      await store.releasePreview(command.sessionId, user.id, command.clientId);
    }
    const session = await store.getPreviewSession(projectId, command.branch);
    return Response.json(session ? previewResponse(session) : { status: "stopped" });
  } catch (error) {
    return apiError(error);
  }
}
