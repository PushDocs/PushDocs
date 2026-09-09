import type { ProviderFileStatus } from "@pushdocs/providers";
import { apiError, workbenchContext } from "@/lib/workbench";

// Cache comparisons only. Drafts and attachment changes are read on every request.
const comparisons = new Map<string, { expires: number; files: ProviderFileStatus[] }>();
export async function GET(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    const { projectId } = await context.params;
    const branch = new URL(request.url).searchParams.get("branch") ?? "";
    const { state, target, provider, store } = await workbenchContext(projectId, branch);
    const base = target.default_branch;
    const statuses: Record<string, string> = Object.create(null);
    if (branch !== base) {
      const key = JSON.stringify([
        projectId,
        target.provider_repository_id,
        base,
        state.branch.head_commit_sha,
      ]);
      let comparison = comparisons.get(key);
      if (!comparison || comparison.expires <= Date.now()) {
        if (!provider.compareFiles) throw new Error("Сравнение веток недоступно");
        comparison = {
          files: await provider.compareFiles(
            target.provider_repository_id,
            base,
            state.branch.head_commit_sha,
          ),
          expires: Date.now() + 30_000,
        };
        if (comparisons.size >= 100) comparisons.clear();
        comparisons.set(key, comparison);
      }
      const prefix = target.root_path === "." ? "" : `${target.root_path}/`;
      for (const file of comparison.files)
        if (file.path.startsWith(prefix)) statuses[file.path.slice(prefix.length)] = file.status;
    }
    if (state.changeSet) {
      for (const file of await store.listAttachments(projectId)) {
        if (file.change_set_id === state.changeSet.id)
          statuses[file.repository_path] =
            statuses[file.repository_path] === "add" ||
            !state.branch.repository_paths.includes(file.repository_path)
              ? "add"
              : "modify";
      }
    }
    return Response.json(
      { statuses, base, sha: state.branch.head_commit_sha },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (error) {
    return apiError(error);
  }
}
