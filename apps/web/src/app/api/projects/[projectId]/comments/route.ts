import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const inputSchema = z.object({
  branch: z.string().min(1),
  path: z.string().min(1),
  body: z.string().trim().min(1).max(20000),
});
export async function GET(request: Request, context: Context) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const store = repository();
    await store.requireProjectAccess(user.id, projectId);
    const query = new URL(request.url).searchParams;
    return Response.json(
      await store.listComments(projectId, query.get("branch") ?? "", query.get("path") ?? ""),
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const store = repository();
    await store.requireProjectAccess(user.id, projectId, "comment:create");
    const input = inputSchema.parse(await readJsonBody(request, 100000));
    await store.createComment({
      projectId,
      userId: user.id,
      branch: input.branch,
      documentPath: input.path,
      body: input.body,
      anchorQuote: null,
    });
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
