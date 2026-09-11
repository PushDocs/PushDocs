import { createHash } from "node:crypto";
import { parseProjectConfig, planTemplate, safePath } from "@pushdocs/content";
import { z } from "zod";
import { providerForConnection } from "@/lib/provider";
import { readJsonBody } from "@/lib/request-body";
import { apiError, assertEditable, assertSameOrigin, localWorkbenchContext } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const fileSchema = z.object({
  path: z.string(),
  content: z.string().max(5_000_000).nullable().optional(),
  revert: z.boolean().optional(),
  createOnly: z.boolean().optional(),
});
const commandSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("folder"),
    branch: z.string(),
    path: z.string(),
    expectedRevision: z.number().int().nonnegative(),
  }),
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
    const { state, config, store, access, target, user } = await localWorkbenchContext(
      projectId,
      branch,
    );
    const query = new URL(request.url).searchParams;
    if (query.has("path")) {
      const path = safePath(query.get("path") ?? "");
      if (!state.branch.repository_paths.includes(path)) throw new Error("Файл не найден");
      const provider = await providerForConnection(target);
      const bytes = await provider.readBinary(
        target.provider_repository_id,
        state.branch.head_commit_sha,
        target.root_path === "." ? path : `${target.root_path}/${path}`,
      );
      if (query.get("download") === "1")
        return new Response(Buffer.from(bytes), {
          headers: {
            "Content-Type": "application/octet-stream",
            "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(path.split("/").at(-1) ?? "file")}`,
            "Content-Security-Policy": "sandbox",
            "X-Content-Type-Options": "nosniff",
            "Cache-Control": "private, no-store",
          },
        });
      let content: string | null = null;
      if (bytes.length <= 2_000_000 && !bytes.includes(0)) {
        try {
          content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
        } catch {
          /* Binary files are downloaded, never interpreted as source. */
        }
      }
      return Response.json({ content }, { headers: { "Cache-Control": "no-store" } });
    }
    return Response.json(
      {
        ownerId: user.id,
        files: state.files,
        uploads: state.changeSet
          ? (await store.listAttachments(projectId))
              .filter((file) => file.change_set_id === state.changeSet?.id)
              .map((file) => ({ path: file.repository_path }))
          : [],
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
    const { store, state, access, target, config, user } = await localWorkbenchContext(
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
      const provider = await providerForConnection(target);
      const created = await provider.createBranch(
        target.provider_repository_id,
        command.name,
        command.sha,
      );
      await store.ensureBranch(projectId, created.name, created.sha);
      await store.enqueueBranchSync(projectId, created.name);
      return Response.json(created);
    }
    if (command.action === "folder") {
      const folder = safePath(command.path);
      const paths = [
        ...state.branch.repository_paths,
        ...state.files.filter((file) => file.status !== "delete").map((file) => file.path),
      ];
      if (
        paths.some(
          (path) =>
            path === folder || path.startsWith(`${folder}/`) || folder.startsWith(`${path}/`),
        )
      )
        throw new Error("Этот путь уже занят");
      await store.stageFiles({
        projectId,
        branch: command.branch,
        userId: user.id,
        expectedRevision: command.expectedRevision,
        files: [{ path: `${folder}/.gitkeep`, content: "", createOnly: true }],
      });
      return Response.json({ saved: true });
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
