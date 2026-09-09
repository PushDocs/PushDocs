import { safePath } from "@pushdocs/content";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

const command = z.object({
  branch: z.string().min(1),
  path: z.string().min(1),
  expectedRevision: z.number().int().nonnegative(),
});

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const input = command.parse(await readJsonBody(request));
    const path = safePath(input.path);
    const store = repository();
    const access = await store.requireProjectAccess(user.id, projectId, "document:write");
    if (path === ".pushdocs/config.json" && access.role !== "admin")
      throw new Error("Конфигурацию изменяет администратор");
    const { changeSet } = await store.getBranchState(projectId, input.branch);
    if (!changeSet) throw new Error("В этой ветке нет неотправленных изменений");
    const drafts = await store.listDraftFiles(projectId, input.branch);
    const uploads = await store.listAttachments(projectId);
    if (
      !drafts.some((file) => file.path === path && file.change_set_id === changeSet.id) &&
      !uploads.some((file) => file.repository_path === path && file.change_set_id === changeSet.id)
    )
      throw new Error("У файла нет неотправленных изменений");
    await store.stageFiles({
      projectId,
      branch: input.branch,
      userId: user.id,
      expectedRevision: input.expectedRevision,
      files: [{ path, revert: true }],
    });
    return Response.json({ reverted: true });
  } catch (error) {
    return apiError(error);
  }
}
