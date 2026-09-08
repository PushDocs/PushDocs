import { createHmac } from "node:crypto";
import { getDatabase, RevisionConflictError } from "@pushdocs/db";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { apiError, assertSameOrigin, workbenchContext } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const schema = z.object({ branch: z.string().min(1), revision: z.number().int().nonnegative() });
export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    if (!process.env.PUSHDOCS_PREVIEW_DOMAIN || !process.env.PUSHDOCS_PREVIEW_KEY)
      throw new Error("Runner предпросмотра не настроен оператором установки");
    const { projectId } = await context.params;
    const input = schema.parse(await readJsonBody(request, 10000));
    const { state, user, store, config } = await workbenchContext(projectId, input.branch);
    await store.requireProjectAccess(user.id, projectId, "document:write");
    if (state.changeSet && state.changeSet.status !== "open")
      throw new Error("Сначала завершите отправку или разрешите конфликты");
    const build = await getDatabase()
      .transaction()
      .execute(async (tx) => {
        // Match upload lock order: project first, then branch, then change set.
        await tx
          .selectFrom("projects")
          .select("id")
          .where("id", "=", projectId)
          .forNoKeyUpdate()
          .executeTakeFirstOrThrow();
        const active = await tx
          .selectFrom("preview_builds")
          .select("id")
          .where("project_id", "=", projectId)
          .where("status", "in", ["queued", "building"])
          .limit(2)
          .execute();
        if (active.length >= 2)
          throw new Error("Не более двух активных сборок на проект. Дождитесь завершения очереди.");
        const branch = await tx
          .selectFrom("branch_contexts")
          .selectAll()
          .where("id", "=", state.branch.id)
          .forUpdate()
          .executeTakeFirstOrThrow();
        const change = await tx
          .selectFrom("change_sets")
          .selectAll()
          .where("branch_context_id", "=", branch.id)
          .where("status", "in", ["open", "conflicted", "submitting"])
          .forUpdate()
          .executeTakeFirst();
        if (change && change.status !== "open")
          throw new Error("Сначала завершите отправку или разрешите конфликты");
        if (
          (change?.revision ?? 0) !== input.revision ||
          (state.changeSet?.revision ?? 0) !== input.revision ||
          branch.head_commit_sha !== state.branch.head_commit_sha
        )
          throw new RevisionConflictError("Черновик обновился. Повторите запрос предпросмотра.");
        const existing = await tx
          .selectFrom("preview_builds")
          .selectAll()
          .where("project_id", "=", projectId)
          .where("branch", "=", input.branch)
          .where("status", "in", ["queued", "building"])
          .executeTakeFirst();
        if (existing) throw new Error("Сборка этой ветки уже выполняется");
        const attachments = change
          ? await tx
              .selectFrom("attachments")
              .select(["repository_path", "storage_key"])
              .where("change_set_id", "=", change.id)
              .execute()
          : [];
        return tx
          .insertInto("preview_builds")
          .values({
            project_id: projectId,
            branch: input.branch,
            sha: branch.head_commit_sha,
            revision: input.revision,
            snapshot: {
              files: state.files
                .filter((file) => file.status !== "clean")
                .map((file) => ({
                  path: file.path,
                  content: file.status === "delete" ? null : file.content,
                })),
              attachments,
              config,
            },
          })
          .returning("id")
          .executeTakeFirstOrThrow();
      });
    return Response.json(build);
  } catch (error) {
    return apiError(error);
  }
}
export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const branch = new URL(request.url).searchParams.get("branch") ?? "";
    const { state } = await workbenchContext(projectId, branch);
    const builds = await getDatabase()
      .selectFrom("preview_builds")
      .select(["id", "sha", "revision", "status", "log", "created_at"])
      .where("project_id", "=", projectId)
      .where("branch", "=", branch)
      .orderBy("created_at", "desc")
      .limit(10)
      .execute();
    const domain = process.env.PUSHDOCS_PREVIEW_DOMAIN;
    const key = process.env.PUSHDOCS_PREVIEW_KEY;
    return Response.json(
      {
        configured: Boolean(domain && key),
        revision: state.changeSet?.revision ?? 0,
        sha: state.branch.head_commit_sha,
        changeStatus: state.changeSet?.status ?? "open",
        builds: builds.map((build) => {
          const expires = Math.floor(Date.now() / 1000) + 900;
          const token = key
            ? createHmac("sha256", key).update(`${build.id}:${expires}`).digest("hex")
            : "";
          const scheme = process.env.PUSHDOCS_PREVIEW_SCHEME === "http" ? "http" : "https";
          return {
            ...build,
            stale:
              build.sha !== state.branch.head_commit_sha ||
              build.revision !== (state.changeSet?.revision ?? 0),
            url:
              build.status === "ready" && domain && key
                ? `${scheme}://${build.id}.${domain}/?expires=${expires}&token=${token}`
                : null,
          };
        }),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
