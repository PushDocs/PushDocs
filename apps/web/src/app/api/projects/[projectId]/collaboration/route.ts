import { parseProjectConfig, safePath } from "@pushdocs/content";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertEditable, assertSameOrigin } from "@/lib/workbench";

const command = z.object({
  branch: z.string().min(1).max(1000),
  path: z.string().min(1).max(1000),
  epoch: z.string().uuid().optional(),
  update: z.string().max(8_000_000).optional(),
  vector: z.string().max(100_000).optional(),
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const input = command.parse(await readJsonBody(request, 8_200_000));
    const store = repository();
    const access = await store.requireProjectAccess(user.id, projectId);
    const path = safePath(input.path);
    if (!/\.mdx?$/i.test(path))
      throw new Error("Совместное редактирование доступно для документов Markdown");
    // A single config read; no provider/VPN requests or full repository enumeration.
    const configFile = await store.getWorkingFile(projectId, input.branch, ".pushdocs/config.json");
    assertEditable(parseProjectConfig(configFile?.content), path, access.role);
    const result = await store.exchangeDocument({ ...input, path, projectId, userId: user.id });
    const { content: _content, ...operations } = result;
    return Response.json(operations, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
