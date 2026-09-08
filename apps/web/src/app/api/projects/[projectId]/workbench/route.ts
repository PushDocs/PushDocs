import { createHash } from "node:crypto";
import { parseProjectConfig, planTemplate } from "@pushdocs/content";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { apiError, assertEditable, assertSameOrigin, workbenchContext } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const fileSchema = z.object({
  path: z.string(),
  content: z.string().max(5_000_000).nullable().optional(),
  revert: z.boolean().optional(),
  createOnly: z.boolean().optional(),
});
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("files"),
    branch: z.string(),
    expectedRevision: z.number().int().nonnegative(),
    files: z.array(fileSchema).min(1).max(500),
  }),
  z.object({
    action: z.literal("branch"),
    branch: z.string(),
    name: z.string().min(1),
    sha: z.string().min(1),
  }),
  z.object({ action: z.literal("sync"), branch: z.string() }),
  z.object({
    action: z.literal("template"),
    branch: z.string(),
    expectedRevision: z.number().int().nonnegative(),
    templateId: z.string(),
    values: z.record(z.string(), z.string()),
    apply: z.boolean().default(false),
    planDigest: z.string().optional(),
  }),
]);

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const branch = new URL(request.url).searchParams.get("branch") ?? "";
    const { state, config, store, access } = await workbenchContext(projectId, branch);
    return Response.json(
      {
        files: state.files,
        revision: state.changeSet?.revision ?? 0,
        changeSetId: state.changeSet?.id,
        status: state.changeSet?.status ?? "open",
        sha: state.branch.head_commit_sha,
        repositoryPaths: state.branch.repository_paths,
        config,
        branches: await store.listBranches(projectId),
        role: access.role,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    if (Number(request.headers.get("content-length")) > 8_000_000)
      throw new Error("Запрос слишком большой");
    const command = commandSchema.parse(await readJsonBody(request));
    const { store, state, access, target, provider, config, user } = await workbenchContext(
      projectId,
      command.branch,
    );
    if (command.action === "sync") {
      await store.enqueueBranchSync(projectId, command.branch);
      return Response.json({ queued: true });
    }
    await store.requireProjectAccess(
      user.id,
      projectId,
      command.action === "branch" ? "branch:push" : "document:write",
    );
    if (command.action === "branch") {
      if (command.sha !== state.branch.head_commit_sha)
        throw new Error("Исходная ветка обновилась. Перечитайте её перед созданием.");
      const created = await provider.createBranch(
        target.provider_repository_id,
        command.name,
        command.sha,
      );
      await store.ensureBranch(projectId, created.name, created.sha);
      await store.enqueueBranchSync(projectId, created.name);
      return Response.json(created);
    }
    const files =
      command.action === "template"
        ? planTemplate(
            config,
            command.templateId,
            command.values,
            new Map(
              state.files
                .filter((file) => file.status !== "delete")
                .map((file) => [file.path, file.content]),
            ),
          )
        : command.files;
    for (const file of files) {
      assertEditable(config, file.path, access.role);
      if (file.path === ".pushdocs/config.json" && file.content) parseProjectConfig(file.content);
    }
    if (command.action === "template") {
      const planDigest = createHash("sha256")
        .update(JSON.stringify({ files, sha: state.branch.head_commit_sha }))
        .digest("hex");
      if (!command.apply) return Response.json({ files, planDigest });
      if (command.planDigest !== planDigest)
        throw new Error("План изменился. Просмотрите файлы ещё раз перед применением.");
    }
    await store.stageFiles({
      projectId,
      branch: command.branch,
      userId: user.id,
      expectedRevision: command.expectedRevision,
      files,
    });
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
