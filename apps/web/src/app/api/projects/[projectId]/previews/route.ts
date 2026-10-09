import { z } from "zod";
import { previewSettings } from "@/lib/preview-settings";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const store = repository();
    await store.requireProjectAccess(user.id, projectId);
    const previews = await store.listProjectPreviews(projectId);
    const { host } = previewSettings();
    return Response.json(
      {
        previews: previews.map((item) => ({
          ...item,
          url: item.port === null ? null : `http://${host}:${item.port}/`,
        })),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const { branch } = z
      .object({ branch: z.string().min(1).max(255) })
      .parse(await readJsonBody(request));
    const store = repository();
    await store.requireProjectAccess(user.id, projectId, "member:manage");
    await store.requestPreviewDeletion(projectId, branch);
    return Response.json({ status: "deleting" }, { status: 202 });
  } catch (error) {
    return apiError(error);
  }
}
