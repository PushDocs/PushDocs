import { assetLocation, isMediaFile, mediaCatalog, safePath } from "@pushdocs/content";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { apiError, assertSameOrigin, localWorkbenchContext } from "@/lib/workbench";

type Context = { params: Promise<{ projectId: string }> };
const command = z.object({
  branch: z.string(),
  path: z.string(),
  revision: z.number().int().nonnegative(),
  action: z.enum(["delete", "revert"]),
  locale: z.string().optional(),
  document: z.string().default("docs/intro.md"),
});

export async function GET(request: Request, context: Context) {
  try {
    const { projectId } = await context.params;
    const query = new URL(request.url).searchParams;
    const branch = query.get("branch") ?? "";
    const { config, state, store, access } = await localWorkbenchContext(projectId, branch);
    const document = query.get("document") ?? "";
    const locale =
      query.get("locale") ??
      state.files.find((file) => file.path === document)?.locale ??
      config.defaultLocale;
    const uploads = (await store.listAttachments(projectId)).filter(
      (file) => file.change_set_id === state.changeSet?.id,
    );
    return Response.json(
      {
        assets: mediaCatalog({
          config,
          locale,
          document,
          paths: state.branch.repository_paths,
          files: state.files,
          uploads: uploads.map((file) => ({
            path: file.repository_path,
            size: Number(file.size_bytes),
          })),
        }),
        revision: state.changeSet?.revision ?? 0,
        status: state.changeSet?.status ?? "open",
        role: access.role,
        locale,
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertSameOrigin(request);
    const { projectId } = await context.params;
    const input = command.parse(await readJsonBody(request));
    const { config, store, user } = await localWorkbenchContext(projectId, input.branch);
    await store.requireProjectAccess(user.id, projectId, "document:write");
    const filePath = safePath(input.path);
    const location = assetLocation(
      config,
      input.locale ?? config.defaultLocale,
      input.document,
      "placeholder",
    );
    if (
      !isMediaFile(filePath) ||
      !filePath.startsWith(location.path.slice(0, location.path.lastIndexOf("/") + 1))
    )
      throw new Error("Файл находится вне настроенного каталога медиа");
    await store.stageFiles({
      projectId,
      branch: input.branch,
      userId: user.id,
      expectedRevision: input.revision,
      files: [
        input.action === "revert"
          ? { path: filePath, revert: true }
          : { path: filePath, content: null },
      ],
    });
    return Response.json({ saved: true });
  } catch (error) {
    return apiError(error);
  }
}
