import { parseProjectConfig, safePath } from "@pushdocs/content";
import { projectConfigPaths } from "@pushdocs/contracts";
import { RevisionConflictError } from "@pushdocs/db";
import { z } from "zod";
import { buildTextDiff, revertDiffLines, textDiffLimits } from "@/components/text-diff";
import { applyRevertEdits, type RevertEdit, revertEdits } from "@/lib/diff-revert-state";
import {
  createDiffRevertUndo,
  diffRevertUndoLimits,
  readDiffRevertUndo,
} from "@/lib/diff-revert-undo";
import { readJsonBody } from "@/lib/request-body";
import { repository, requireUser } from "@/lib/server";
import { apiError, assertSameOrigin } from "@/lib/workbench";

const command = z
  .object({
    branch: z.string().min(1),
    path: z.string().min(1),
    expectedRevision: z.number().int().nonnegative(),
    expectedHeadSha: z.string().min(1).optional(),
    lineIds: z.array(z.number().int().nonnegative()).min(1).max(textDiffLimits.lines).optional(),
    restoreToken: z.string().min(1).max(diffRevertUndoLimits.tokenCharacters).optional(),
    restoreBlocks: z
      .array(z.number().int().nonnegative())
      .min(1)
      .max(textDiffLimits.lines)
      .optional(),
  })
  .refine(
    (input) =>
      (!input.restoreToken || !input.lineIds) && (!input.restoreBlocks || !!input.restoreToken),
  );

export async function POST(request: Request, context: { params: Promise<{ projectId: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireUser();
    const { projectId } = await context.params;
    const input = command.parse(await readJsonBody(request, diffRevertUndoLimits.requestBytes));
    const path = safePath(input.path);
    const store = repository();
    const access = await store.requireProjectAccess(user.id, projectId, "document:write");
    if (path === projectConfigPaths.config && access.role !== "admin")
      throw new Error("Конфигурацию изменяет администратор");
    const { branch, changeSet } = await store.getBranchState(projectId, input.branch);
    if (!changeSet) {
      if (input.restoreToken) throw new RevisionConflictError("Набор изменений уже недоступен.");
      throw new Error("В этой ветке нет неотправленных изменений");
    }
    const drafts = await store.listDraftFiles(projectId, input.branch);
    const uploads = await store.listAttachments(projectId);
    if (
      !input.restoreToken &&
      !drafts.some((file) => file.path === path && file.change_set_id === changeSet.id) &&
      !uploads.some((file) => file.repository_path === path && file.change_set_id === changeSet.id)
    )
      throw new Error("У файла нет неотправленных изменений");
    const scope = { projectId, userId: user.id, branch: input.branch, path };
    let content: string | null | undefined;
    let undoToken: string | undefined;
    let undoBlocks: RevertEdit[] = [];
    let expectedChangeSetId: string | undefined;
    let reverted = true;
    if (input.lineIds || input.restoreToken) {
      if (
        changeSet.revision !== input.expectedRevision ||
        changeSet.status !== "open" ||
        branch.head_commit_sha !== input.expectedHeadSha
      )
        throw new RevisionConflictError("Изменения обновились. Обновите страницу.");
      if (
        uploads.some((file) => file.repository_path === path && file.change_set_id === changeSet.id)
      )
        throw new Error("Для этого файла доступен только полный откат");
      expectedChangeSetId = changeSet.id;
      if (input.restoreToken) {
        const snapshot = readDiffRevertUndo(scope, input.restoreToken);
        if (snapshot.changeSetId !== changeSet.id || snapshot.headSha !== branch.head_commit_sha)
          throw new RevisionConflictError("Изменения обновились. Восстановление недоступно.");
        const file = await store.getWorkingFile(projectId, input.branch, path);
        const current = !file || file.status === "delete" ? null : file.content;
        const indexes = input.restoreBlocks ?? snapshot.blocks.map((_, index) => index);
        if (
          new Set(indexes).size !== indexes.length ||
          indexes.some((index) => !snapshot.blocks[index])
        )
          throw new Error("Фрагменты восстановления недоступны.");
        try {
          content = applyRevertEdits(
            snapshot.after,
            current,
            snapshot.content !== null,
            indexes.map((index) => snapshot.blocks[index] as RevertEdit),
          );
        } catch (error) {
          throw new RevisionConflictError(
            error instanceof Error ? error.message : "Фрагмент изменился.",
          );
        }
        reverted = false;
      } else if (input.lineIds) {
        const file = await store.getWorkingFile(projectId, input.branch, path);
        if (!file?.baseContentKnown)
          throw new Error("Исходная версия недоступна для построчного отката");
        content = revertDiffLines(file.baseContent, file.content, input.lineIds);
        reverted = content === file.baseContent;
        const comparison = buildTextDiff(file.baseContent, file.content);
        if (!comparison) throw new Error("Фрагменты изменений недоступны.");
        undoBlocks = revertEdits(comparison.lines, input.lineIds);
        // Only the server can authorize restoring this exact prior state and path.
        undoToken = createDiffRevertUndo(scope, {
          changeSetId: changeSet.id,
          headSha: branch.head_commit_sha,
          content: file.status === "delete" ? null : file.content,
          after:
            reverted && !branch.repository_paths?.includes(path) && !file.baseContent
              ? null
              : (content ?? null),
          blocks: undoBlocks,
        });
      }
      if (!reverted && content !== null && path === projectConfigPaths.config)
        parseProjectConfig(content);
    }
    // Whole text-file reverts use the same undo history as line and hunk reverts.
    if (
      !input.lineIds &&
      !input.restoreToken &&
      !uploads.some((file) => file.repository_path === path && file.change_set_id === changeSet.id)
    ) {
      const file = await store.getWorkingFile(projectId, input.branch, path);
      const comparison = file?.baseContentKnown
        ? buildTextDiff(file.baseContent, file.content)
        : null;
      if (file && comparison) {
        undoBlocks = revertEdits(
          comparison.lines,
          comparison.lines.filter((line) => line.kind !== "context").map((line) => line.id),
        );
        if (!undoBlocks.length) undoBlocks = [{ start: 0, end: 0, text: "" }];
        content =
          !branch.repository_paths?.includes(path) && !file.baseContent ? null : file.baseContent;
        undoToken = createDiffRevertUndo(scope, {
          changeSetId: changeSet.id,
          headSha: branch.head_commit_sha,
          content: file.status === "delete" ? null : file.content,
          after: content,
          blocks: undoBlocks,
        });
        expectedChangeSetId = changeSet.id;
      }
    }
    const saved = await store.stageFiles({
      projectId,
      branch: input.branch,
      userId: user.id,
      expectedRevision: input.expectedRevision,
      ...(expectedChangeSetId
        ? { expectedHeadSha: input.expectedHeadSha ?? branch.head_commit_sha, expectedChangeSetId }
        : {}),
      files: [reverted ? { path, revert: true } : { path, content }],
    });
    return Response.json({
      reverted,
      ...saved,
      ...(content !== undefined ? { content } : {}),
      ...(undoToken
        ? {
            undoToken,
            undoHeadSha: branch.head_commit_sha,
            undoBlocks: undoBlocks.map(({ start, end }, index) => ({ index, start, end })),
          }
        : {}),
    });
  } catch (error) {
    return apiError(error);
  }
}
