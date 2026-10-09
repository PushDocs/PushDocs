import {
  browserPreviewIdleTtlMs,
  type PreviewRuntimeStatus,
  previewLifecycle,
} from "@pushdocs/domain";
import { z } from "zod";
import { previewSettings } from "@/lib/preview-settings";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };

const commandSchema = z.object({
  action: z.enum(["acquire", "attach", "heartbeat", "release"]),
  branch: z.string().min(1).max(255),
  clientId: z.string().uuid(),
  sessionId: z.string().uuid().optional(),
});

async function previewResponse(session: {
  id: string;
  last_error: string | null;
  log: string;
  port: number;
  status: PreviewRuntimeStatus;
  desired_state: "running" | "stopped";
  user_stopped: boolean;
  project_id: string;
  branch: string;
  revision: number;
  head_sha: string | null;
}) {
  const fresh = session.status !== "ready" || (await repository().isPreviewCurrent(session));
  const { runtimeStatus: status, canOpen } = previewLifecycle({ session, contentCurrent: fresh });
  const message = session.log
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
    ?.slice(0, 240);
  return {
    sessionId: session.id,
    status,
    manuallyStopped: session.user_stopped,
    error: session.last_error,
    log: session.log,
    message: fresh ? message : "Обновляем файлы предпросмотра…",
    waitingForCapacity:
      session.status === "queued" && session.log.startsWith("Ожидаем свободное место"),
    url: canOpen ? `http://${previewSettings().host}:${session.port}/` : undefined,
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
          status: workspace.delete_requested ? "deleting" : "stopped",
          manuallyStopped: true,
        },
        {
          headers: { "Cache-Control": "private, no-store" },
        },
      );
    const session = await store.getPreviewSession(projectId, branch);
    return Response.json(session ? await previewResponse(session) : { status: "stopped" }, {
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
    if (command.action === "attach") {
      const session = await store.attachPreview({
        branch: command.branch,
        clientId: command.clientId,
        projectId,
        userId: user.id,
      });
      return Response.json(session ? await previewResponse(session) : { status: "stopped" });
    }
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
      return Response.json(await previewResponse(session));
    }
    if (!command.sessionId) throw new Error("Сессия предпросмотра не указана");
    const current = await store.getPreviewSession(projectId, command.branch);
    if (!current || current.id !== command.sessionId)
      throw new Error("Сессия предпросмотра не найдена");
    if (command.action === "heartbeat") {
      const active = await store.heartbeatPreview(command.sessionId, user.id, command.clientId);
      if (!active) throw new Error("Сессия предпросмотра завершена");
    } else {
      await store.releasePreview(
        command.sessionId,
        user.id,
        command.clientId,
        browserPreviewIdleTtlMs,
      );
    }
    const session = await store.getPreviewSession(projectId, command.branch);
    return Response.json(session ? await previewResponse(session) : { status: "stopped" });
  } catch (error) {
    return apiError(error);
  }
}
