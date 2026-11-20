import type { BranchFreshness } from "@/lib/branch-freshness";
import { providerForConnection } from "@/lib/provider";
import { repository, requireUser } from "@/lib/server";
import { apiError } from "@/lib/workbench";

export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const user = await requireUser();
    const { projectId } = await context.params;
    const branch = new URL(request.url).searchParams.get("branch");
    if (!branch) throw new Error("Выберите ветку");
    const store = repository();
    await store.requireProjectAccess(user.id, projectId, "project:read");
    const target = await store.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    const provider = await providerForConnection(target);
    const branches = await provider.listBranches(target.provider_repository_id);
    const remoteSha = branches.find((item) => item.name === branch)?.sha ?? null;
    const defaultHeadSha =
      branches.find((item) => item.name === target.default_branch)?.sha ?? null;
    let includesDefaultBranch: boolean | null = null;
    if (remoteSha && defaultHeadSha) {
      if (remoteSha === defaultHeadSha) includesDefaultBranch = true;
      else if (provider.isAncestor)
        includesDefaultBranch = await provider
          .isAncestor(target.provider_repository_id, defaultHeadSha, remoteSha)
          .catch(() => null);
    }
    return Response.json(
      {
        remoteSha,
        defaultBranch: target.default_branch,
        defaultHeadSha,
        includesDefaultBranch,
      } satisfies BranchFreshness,
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
