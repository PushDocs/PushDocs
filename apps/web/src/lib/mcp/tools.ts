import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeContent } from "@pushdocs/content";
import { readMetadata } from "@pushdocs/content/metadata";
import {
  branchUpdateLimits,
  ConflictReportMode,
  conflictReportLimits,
  reviewDescriptionMaxLength,
} from "@pushdocs/contracts";
import {
  canonicalJson,
  getDatabase,
  McpError,
  type McpPrincipal,
  McpRepository,
  PushDocsRepository,
} from "@pushdocs/db";
import { previewLifecycle } from "@pushdocs/domain";
import { z } from "zod";
import { externalPreviewUrl } from "../external-preview";
import { previewSettings } from "../preview-settings";
import { ProjectService } from "../project-service";
import { conflictResolutionInput } from "./conflict-report";
import { compressImage, documentImages, fixSpelling, spelling } from "./quality";
import { ReviewService } from "./reviews";

const projectId = z.string().uuid(),
  branch = z.string().min(1).max(255),
  path = z.string().min(1).max(1000),
  revision = z.number().int().nonnegative();
const context = { projectId, branch },
  write = { ...context, idempotencyKey: z.string().min(1).max(200) },
  edit = { ...write, expectedRevision: revision };
const paging = {
  cursor: z.string().regex(/^\d+$/).optional(),
  limit: z.number().int().min(1).max(100).default(30),
};
function page<T>(items: T[], input: { cursor?: string; limit: number }) {
  const offset = Number(input.cursor ?? 0);
  return {
    items: items.slice(offset, offset + input.limit),
    nextCursor: offset + input.limit < items.length ? String(offset + input.limit) : null,
    total: items.length,
  };
}
const safeResult = (value: unknown) => {
  const text = canonicalJson(value);
  if (text.length > 1_000_000)
    throw new McpError(
      "RESULT_TOO_LARGE",
      "Result exceeds 1 MB. Request a smaller page or individual document.",
    );
  return {
    content: [{ type: "text" as const, text }],
    structuredContent:
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : { result: value },
  };
};
const toolScopes: Record<string, string> = Object.fromEntries([
  ...[
    "list_projects",
    "get_project",
    "list_branches",
    "list_open_reviews",
    "inspect_review_conflicts",
    "get_conflict_report",
    "get_conflict_file",
    "list_documents",
    "get_document",
    "search_documents",
    "find_documents_by_topic",
    "get_document_backlinks",
    "get_change_set",
    "get_branch_changes",
    "get_operation_status",
    "get_navigation",
    "check_spelling",
    "list_document_images",
    "get_preview_status",
    "list_previews",
    "plan_document_template",
  ].map((name) => [name, "pushdocs:read"]),
  ...[
    "create_branch",
    "create_document",
    "update_document",
    "apply_document_template",
    "add_document_to_navigation",
    "move_navigation_item",
    "remove_navigation_item",
    "fix_spelling",
    "compress_image",
    "compress_document_images",
  ].map((name) => [name, "pushdocs:write"]),
  ["start_preview", "pushdocs:preview"],
  ["stop_preview", "pushdocs:preview"],
  ["submit_changes", "pushdocs:submit"],
  ["update_review_branch", "pushdocs:submit"],
  ["resume_review_branch_update", "pushdocs:submit"],
  ["resolve_review_conflicts", "pushdocs:submit"],
  ["resume_conflict_resolution", "pushdocs:submit"],
]);
export function scopeForTool(name: string) {
  return toolScopes[name];
}
export function createMcpServer(principal: McpPrincipal, db = getDatabase()) {
  const server = new McpServer(
    { name: "PushDocs", version: "0.1.0" },
    {
      instructions:
        "PushDocs manages documentation stored in Git repositories. Read/search before editing. Change sets are shared by all project users on a branch. Create a branch for your task. Reload after revision conflicts. Review the complete change set before submitting. Only submit when the user explicitly requests commit/push/PR/MR. Preview when appropriate. Poll operation IDs until completion. " +
        "To update ALL open PRs/MRs from stable (or another named target), paginate list_open_reviews with that exact targetBranch; never use list_branches as the update set. Update each distinct source/target branch pair once using update_review_branch and its listed headSha. The update strategy comes from repository settings with git.updateStrategy overriding it in the target branch project config; readiness status never selects the strategy. Poll each operation and continue other branches after individual failures. Summarize updated, already_current, conflicted and failed items with review links; never create new reviews or merge/close reviews. " +
        "To recover interrupted work in a new chat, read get_project with the source branch: pendingOperation identifies the operation reserving it even after the PR/MR closes. Poll queued/running operations. When canResumeReviewBranchUpdate is true and the user requests resuming the update/push, call resume_review_branch_update with that operationId and a NEW idempotencyKey. Preserve the prepared result; do not start a replacement update. Reading recovery state never resumes or publishes it. " +
        "If an update/resolution is blocked by saved changes, show the affected paths and editor/review links. Recommend reviewing and explicitly committing AND pushing the entire shared change set, canceling explicitly selected unwanted edits in the editor, or keeping drafts and skipping the branch. If an upload/operation is active, recommend waiting first. A blocked result has no operationId: do not poll it, and continue other reviews. Never suggest stash or automatically submit/discard drafts to unblock an update; a bulk branch-update request does not authorize publishing saved drafts. Local unsaved browser/computer edits are not visible to MCP. " +
        "Conflict reports are for nontechnical text editors. Default to editorial mode: article/section and links, common original version, what changed in the current target, what changed in the user's branch, then suggested combined wording, consequences and any concrete question needed. Distinguish confirmed text changes from inferred intentions. Dates identify commit snapshots, not paragraph edits or PR merge dates. Use actual branch names, never ambiguous ours/theirs. Use detailed mode only for an explicit request for detailed conflict analysis, raw changes or diff; show exact fragments and surrounding context. Read further pages and get_conflict_file when context is insufficient; disclose truncation and stale reports. " +
        "Both conflict modes are metadata-only for media. Never automatically fetch/open image, GIF, video or binary links, generate thumbnails, extract frames or compare pixels. A detailed request does NOT authorize media viewing; only a separate explicit request for the selected media does. Check article references before recommending media deletion, and disclose incomplete reference checks. Analysis alone must not apply changes. On an explicit request to resolve, apply clear decisions; ask only about unresolved semantic/media choices. Use fragment decisions to preserve clean changes. Never substitute a merge resolution for a required rebase. At needs_resolution, stop polling and get_conflict_report with the same operationId as inspectionId. For comparisonKind=rebase, explain the actual commit and sideMeaning; pass its exact rebase.conflictId to resolve_review_conflicts. Continue polling the same operationId after resolving; another commit may need a separate decision. Intermediate commits are never pushed.",
    },
  );
  const auth = new McpRepository(db);
  function tool<S extends z.ZodRawShape>(
    name: string,
    description: string,
    shape: S,
    scope: string,
    mutates: boolean,
    run: (service: ProjectService, input: z.output<z.ZodObject<S>>) => Promise<unknown>,
  ) {
    server.registerTool(
      name,
      {
        description,
        inputSchema: z.object(shape) as z.ZodObject<z.ZodRawShape>,
        annotations: {
          readOnlyHint: !mutates || name === "inspect_review_conflicts",
          destructiveHint: mutates && name !== "inspect_review_conflicts",
          idempotentHint: true,
          openWorldHint: [
            "create_branch",
            "submit_changes",
            "start_preview",
            "get_branch_changes",
            "list_open_reviews",
            "update_review_branch",
            "resume_review_branch_update",
            "inspect_review_conflicts",
            "get_conflict_report",
            "resolve_review_conflicts",
            "resume_conflict_resolution",
          ].includes(name),
        },
      },
      async (raw) => {
        try {
          const input = raw as z.output<z.ZodObject<S>>,
            record = input as Record<string, unknown>;
          if (!principal.scopes.includes(scope))
            throw new McpError(
              "INSUFFICIENT_SCOPE",
              `This tool requires ${scope}. Authorize again with that scope.`,
              403,
            );
          if (record.projectId && !principal.projects.includes(String(record.projectId)))
            throw new McpError("PROJECT_NOT_FOUND", "Project is outside this OAuth grant.", 404);
          await auth.rateLimit(
            `mcp:${principal.grantId}:${mutates ? "write" : "read"}`,
            mutates ? 30 : 120,
          );
          const service = new ProjectService(new PushDocsRepository(db), principal.userId);
          if (record.projectId)
            await service.store.requireProjectAccess(principal.userId, String(record.projectId));
          const result = mutates
            ? await auth.write(principal, name, record, (tx) =>
                run(new ProjectService(new PushDocsRepository(tx), principal.userId), input),
              )
            : await run(service, input);
          return safeResult(result);
        } catch (error) {
          const code =
            error && typeof error === "object" && "code" in error
              ? String(error.code)
              : "OPERATION_FAILED";
          if (mutates)
            await auth
              .audit(principal, name, raw as Record<string, unknown>, {
                status: "failed",
                errorCode: code,
              })
              .catch(() => {});
          const allowed = ["REVISION_CONFLICT", "ACCESS_DENIED", "UNSUPPORTED_NAVIGATION_FORMAT"];
          const message =
            error instanceof McpError || (allowed.includes(code) && error instanceof Error)
              ? error.message
              : "Operation failed. Reload the project state or inspect the server operation status.";
          return {
            isError: true,
            content: [
              {
                type: "text" as const,
                text: JSON.stringify({ code, message, retryable: code === "RATE_LIMITED" }),
              },
            ],
            structuredContent: { error: { code, message, retryable: code === "RATE_LIMITED" } },
          };
        }
      },
    );
  }
  tool(
    "list_projects",
    "List projects permitted by this OAuth grant and your current project memberships.",
    { ...paging },
    "pushdocs:read",
    false,
    async (s, i) =>
      page(
        (await s.store.listProjects(principal.userId)).filter((p) =>
          principal.projects.includes(p.id),
        ),
        i,
      ),
  );
  tool(
    "get_project",
    "Read project configuration, roots, templates, branch snapshot and pendingOperation. Use the source branch to discover reserved work after losing its operationId, including after the PR/MR closes. This read never resumes or publishes work. Credentials are never returned.",
    { projectId, branch: branch.optional() },
    "pushdocs:read",
    false,
    (s, i) => s.project(i.projectId, i.branch),
  );
  tool(
    "list_branches",
    "List imported/discovered branches and source SHA. A newly created branch must finish importing before editing.",
    { projectId, search: z.string().max(200).optional(), ...paging },
    "pushdocs:read",
    false,
    async (s, i) =>
      page(
        (await s.store.listBranches(i.projectId)).filter(
          (b) => !i.search || b.full_ref.includes(i.search),
        ),
        i,
      ),
  );
  tool(
    "list_open_reviews",
    "List LIVE open GitHub PRs / GitLab MRs, optionally filtered by exact target/source branch. Paginate all results for bulk requests. Closed and merged reviews are excluded. Does not download file contents.",
    { projectId, targetBranch: branch.optional(), sourceBranch: branch.optional(), ...paging },
    "pushdocs:read",
    false,
    async (s, i) =>
      page(
        await new ReviewService(s, principal.grantId).list(
          i.projectId,
          i.targetBranch,
          i.sourceBranch,
        ),
        i,
      ),
  );
  tool(
    "update_review_branch",
    "Update one LIVE open PR/MR source branch from its current target and PUSH immediately; the review stays open. Only on an explicit update/push request. Pass targetBranch and headSha from list_open_reviews. Git decides whether already current. Poll operation; conflicts do not publish. For all reviews iterate the complete filtered list, deduplicating branches and continuing after failures.",
    {
      projectId,
      reviewId: z.string().min(1).max(200),
      targetBranch: branch,
      expectedHeadSha: z.string().min(1).max(64),
      idempotencyKey: write.idempotencyKey,
    },
    "pushdocs:submit",
    true,
    (s, i) => new ReviewService(s, principal.grantId).update(i),
  );
  tool(
    "resume_review_branch_update",
    "Resume the SAME prepared review branch update after a failed/uncertain push, with renewed authorization. Find its operationId in get_project(projectId, branch).pendingOperation or get_operation_status when canResumeReviewBranchUpdate=true. Only on an explicit resume/update/push request. Pass a NEW idempotencyKey; replay that same key if this call's response is lost. The original strategy, commits and SHAs are preserved. An already published result is reconciled even after the PR/MR closes; an unpublished result still requires a live open review and current safety checks. Poll operationId.",
    { projectId, operationId: z.string().uuid(), idempotencyKey: write.idempotencyKey },
    "pushdocs:submit",
    true,
    async (s, i) => {
      const operationId = await s.store.retryReviewBranchUpdate(
        i.projectId,
        i.operationId,
        principal.userId,
        principal.grantId,
      );
      const operation = await s.store.getMcpOperation(i.projectId, operationId);
      return { operationId, status: operation?.status, branch: operation?.result.branch };
    },
  );
  tool(
    "inspect_review_conflicts",
    "Inspect a live open review without committing or pushing. If rebase is paused, returns the same operationId and its current conflicting commit. Otherwise compares branch tips. Media contents are excluded. Poll until done or needs_resolution, then call get_conflict_report using inspectionId. A rebase tip comparison requires update_review_branch before resolving individual commits.",
    {
      projectId,
      reviewId: z.string().min(1).max(200),
      refresh: z.boolean().default(false),
      idempotencyKey: write.idempotencyKey,
    },
    "pushdocs:read",
    true,
    (s, i) => new ReviewService(s, principal.grantId).inspect(i),
  );
  tool(
    "get_conflict_report",
    "Read conflict evidence with immutable article/version links and commit dates. Default editorial: explain original -> current target change / user's branch change -> recommendation in plain language. Detailed only when explicitly requested: show actual fragments and context. Always disclose media not inspected and any truncation/staleness. Follow nextCursor, nextFragmentCursor and nextReferenceCursor; fragment/reference cursors require path. No media download in either mode.",
    {
      projectId,
      inspectionId: z.string().uuid(),
      mode: z.enum(ConflictReportMode).default(ConflictReportMode.Editorial),
      path: path.optional(),
      cursor: paging.cursor,
      limit: z
        .number()
        .int()
        .min(1)
        .max(conflictReportLimits.files)
        .default(conflictReportLimits.files),
      fragmentCursor: paging.cursor,
      referenceCursor: paging.cursor,
    },
    "pushdocs:read",
    false,
    (s, i) => {
      if ((i.fragmentCursor || i.referenceCursor) && !i.path)
        throw new McpError("INVALID_ARGUMENT", "Fragment/reference cursors require path.");
      return new ReviewService(s, principal.grantId).report({
        ...i,
        offset: Number(i.cursor ?? 0),
        fragmentOffset: Number(i.fragmentCursor ?? 0),
        referenceOffset: Number(i.referenceCursor ?? 0),
      });
    },
  );
  tool(
    "get_conflict_file",
    "Read a complete conflict TEXT version in bounded chunks when the report lacks context. version=base is the common original, branch is the user's branch, target is the current target. Follow nextOffset. Media bytes are excluded even in detailed mode.",
    {
      projectId,
      inspectionId: z.string().uuid(),
      path,
      version: z.enum(["base", "branch", "target"]),
      offset: z.number().int().nonnegative().default(0),
      limit: z
        .number()
        .int()
        .min(1)
        .max(conflictReportLimits.fileChars)
        .default(conflictReportLimits.fileChars),
    },
    "pushdocs:read",
    false,
    (s, i) => new ReviewService(s, principal.grantId).file(i),
  );
  tool(
    "resolve_review_conflicts",
    "Apply explicitly requested decisions for ALL conflict files. Merge publishes a merge commit; a paused rebase continues the SAME operation and may return needs_resolution for another commit. Rebase pushes only after all commits are replayed. PR/MR stays open. Requires current inspectionId. For text, choice branch/target selects that side of all conflict fragments while preserving clean edits from both branches. For media or modify/delete, it chooses the complete file including deletion. combine supplies EVERY conflict fragment by zero-based index, choosing branch/target/manual text. Never guess ambiguous text/media choices. For rebase, branch means the current rebased foundation and target means the original commit being replayed. Read comparisonKind and rebase metadata before choosing sides.",
    {
      projectId,
      inspectionId: z.string().uuid(),
      conflictId: z
        .string()
        .max(branchUpdateLimits.conflictIdChars)
        .optional()
        .describe("Required for rebase: exact conflictId from the current report."),
      files: conflictResolutionInput,
      idempotencyKey: write.idempotencyKey,
    },
    "pushdocs:submit",
    true,
    (s, i) => new ReviewService(s, principal.grantId).resolve(i),
  );
  tool(
    "resume_conflict_resolution",
    "Resume the SAME prepared conflict resolution after a failed/uncertain push, with renewed authorization. Use when get_operation_status reports canResumeConflictResolution=true and the user still requests publishing those decisions. Pass a NEW idempotencyKey. The original prepared merge is recovered, never recalculated from new branch versions. Poll operationId; an already published result is reconciled without another push.",
    { projectId, operationId: z.string().uuid(), idempotencyKey: write.idempotencyKey },
    "pushdocs:submit",
    true,
    async (s, i) => {
      const operationId = await s.store.retryConflictMerge(
        i.projectId,
        i.operationId,
        principal.userId,
        principal.grantId,
      );
      const operation = await s.store.getMcpOperation(i.projectId, operationId);
      return { operationId, status: "queued", branch: operation?.result.branch };
    },
  );
  tool(
    "list_documents",
    "List working documents including shared saved drafts. Deleted documents are excluded.",
    {
      ...context,
      ...paging,
      root: path.optional(),
      search: z.string().max(200).optional(),
      locale: z.string().optional(),
      version: z.string().optional(),
      status: z.string().optional(),
    },
    "pushdocs:read",
    false,
    async (s, i) => {
      const c = await s.context(i.projectId, i.branch);
      return {
        ...c.snapshot,
        ...page(
          s
            .documents(c)
            .filter(
              (f) =>
                (!i.root || f.path.startsWith(`${i.root}/`)) &&
                (!i.search || f.path.includes(i.search)) &&
                (!i.locale || f.locale === i.locale) &&
                (!i.version || f.version === i.version) &&
                (!i.status || f.status === i.status),
            )
            .map(({ content, baseContent, ...f }) => f),
          i,
        ),
      };
    },
  );
  tool(
    "get_document",
    "Read a working Markdown/MDX document. Use revisionToken and changeSetRevision for updates.",
    { ...context, path },
    "pushdocs:read",
    false,
    async (s, i) => {
      const c = await s.document(i.projectId, i.branch, i.path);
      return {
        ...c.snapshot,
        path: c.file.path,
        title: c.file.title,
        content: c.file.content,
        frontmatter: readMetadata(c.file.content),
        links: analyzeContent(c.file.content).links,
        revisionToken: c.revisionToken,
      };
    },
  );
  for (const topic of [false, true])
    tool(
      topic ? "find_documents_by_topic" : "search_documents",
      topic
        ? "Find documents using lexical topic ranking. This MVP does not guarantee semantic recall without shared terms."
        : "Find literal text in working document source, including code and frontmatter.",
      { ...context, query: z.string().min(1).max(1000), ...paging },
      "pushdocs:read",
      false,
      async (s, i) => {
        const r = await s.search(i.projectId, i.branch, i.query, topic);
        return { ...r, results: undefined, ...page(r.results, i) };
      },
    );
  tool(
    "get_document_backlinks",
    "List incoming working-document links. Dynamic and ambiguous MDX links may be unresolved.",
    { ...context, path, ...paging },
    "pushdocs:read",
    false,
    async (s, i) => {
      const r = await s.backlinks(i.projectId, i.branch, i.path);
      return {
        ...r,
        incoming: undefined,
        unresolved: r.unresolved.slice(0, 100),
        ...page(r.incoming, i),
      };
    },
  );
  tool(
    "create_branch",
    "Create a remote branch from an exact imported Git SHA, then import it. Does not copy source drafts. Poll operationId.",
    {
      projectId,
      idempotencyKey: write.idempotencyKey,
      baseBranch: branch,
      sourceSha: z.string().min(1),
      branchName: branch,
    },
    "pushdocs:write",
    true,
    async (s, i) => {
      await s.store.requireProjectAccess(principal.userId, i.projectId, "branch:push");
      const c = await s.context(i.projectId, i.baseBranch);
      if (c.snapshot.headCommitSha !== i.sourceSha)
        throw new McpError("REVISION_CONFLICT", "Source SHA changed.", 409);
      const operationId = await s.store.enqueueBranchCreation({
        projectId: i.projectId,
        sourceBranch: i.baseBranch,
        sourceSha: i.sourceSha,
        branch: i.branchName,
        userId: principal.userId,
        oauthGrantId: principal.grantId,
      });
      return { operationId, status: "queued", branch: i.branchName };
    },
  );
  tool(
    "create_document",
    "Create a document in the shared change set. Does not commit or push.",
    {
      ...edit,
      path,
      content: z.string().max(5_000_000),
      title: z.string().max(500).optional(),
      frontmatter: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
    },
    "pushdocs:write",
    true,
    (s, i) => s.create(i),
  );
  tool(
    "update_document",
    "Replace document source only if revisionToken and change set revision still match. Does not commit or push.",
    { ...edit, path, content: z.string().max(5_000_000), revisionToken: z.string() },
    "pushdocs:write",
    true,
    (s, i) => s.update(i),
  );
  tool(
    "plan_document_template",
    "Preview all files created/updated by a project template. Review the plan before applying.",
    { ...context, templateId: z.string(), values: z.record(z.string(), z.string()) },
    "pushdocs:read",
    false,
    (s, i) => s.template({ ...i, apply: false, expectedRevision: 0 }),
  );
  tool(
    "apply_document_template",
    "Apply a reviewed template plan atomically to the shared change set.",
    {
      ...edit,
      templateId: z.string(),
      values: z.record(z.string(), z.string()),
      planDigest: z.string(),
    },
    "pushdocs:write",
    true,
    (s, i) => s.template({ ...i, apply: true }),
  );
  tool(
    "get_change_set",
    "Inspect shared unsubmitted changes, including other users' edits and attachments. Review before submit.",
    { ...context, ...paging },
    "pushdocs:read",
    false,
    async (s, i) => {
      const c = await s.context(i.projectId, i.branch);
      const changes = await s.store.listChangedWorkingFiles(i.projectId, i.branch);
      return {
        ...c.snapshot,
        status: c.state.changeSet?.status ?? "open",
        ...page(
          changes.files.map((f) => ({
            path: f.path,
            status: f.status,
            baseContent: f.baseContent.slice(0, 20_000),
            content: f.content.slice(0, 20_000),
            truncated: f.content.length > 20_000 || f.baseContent.length > 20_000,
          })),
          i,
        ),
        attachments: c.state.changeSet
          ? await s.store.listAttachmentsForChangeSet(i.projectId, c.state.changeSet.id)
          : [],
      };
    },
  );
  tool(
    "get_branch_changes",
    "Compare imported Git branch snapshots. Unsubmitted drafts are returned separately by get_change_set.",
    { ...context, baseBranch: branch, ...paging },
    "pushdocs:read",
    false,
    async (s, i) => {
      const r = await s.branchChanges(i.projectId, i.branch, i.baseBranch);
      return { ...r, files: undefined, ...page(r.files, i) };
    },
  );
  tool(
    "get_operation_status",
    "Read branch creation, update, conflict inspection/resolution or submission status. Poll until done, failed or needs_resolution. At needs_resolution, read get_conflict_report with this operationId as inspectionId, resolve the current commit, then continue polling the same operationId. Only done updates have updateOutcome. Failed prepared operations expose canResumeReviewBranchUpdate or canResumeConflictResolution for recovery of the same result. If the operationId was lost, read get_project(projectId, branch).pendingOperation.",
    { projectId, operationId: z.string().uuid() },
    "pushdocs:read",
    false,
    async (s, i) => {
      const result = await s.store.getMcpOperation(i.projectId, i.operationId);
      if (!result) throw new McpError("OPERATION_NOT_FOUND", "Operation not found.", 404);
      const ciPreviewUrl =
        result.result.ciPreviewStatus === "success" && result.result.reviewNumber
          ? (externalPreviewUrl(process.env.PUSHDOCS_PREVIEW_URL, result.result.reviewNumber) ??
            null)
          : null;
      return { operationId: i.operationId, ...result, result: { ...result.result, ciPreviewUrl } };
    },
  );
  tool(
    "get_navigation",
    "Read a static sidebar tree. Item identifiers are valid for this change set revision.",
    { ...context, path: path.default("sidebars.js") },
    "pushdocs:read",
    false,
    async (s, i) => {
      const c = await s.navigation(i.projectId, i.branch, i.path);
      return { ...c.snapshot, path: i.path, tree: c.tree, format: "static-literal" };
    },
  );
  for (const action of ["add", "move", "remove"] as const)
    tool(
      action === "add"
        ? "add_document_to_navigation"
        : action === "move"
          ? "move_navigation_item"
          : "remove_navigation_item",
      "Edit a static sidebar in the shared change set. Removing an item does not delete its document. Use get_navigation identifiers.",
      {
        ...edit,
        path: path.default("sidebars.js"),
        document: path.optional(),
        item: z.string().optional(),
        parent: z.string().optional(),
        position: z
          .union([
            z.number().int().nonnegative(),
            z.literal("first"),
            z.literal("last"),
            z.object({ before: z.string() }),
            z.object({ after: z.string() }),
          ])
          .optional(),
      },
      "pushdocs:write",
      true,
      (s, i) => s.editNavigation({ ...i, action }),
    );
  tool(
    "check_spelling",
    "Check Russian/English prose locally. Ignores code, URLs, imports and MDX syntax. Does not edit.",
    { ...context, path, language: z.enum(["ru", "en"]).optional() },
    "pushdocs:read",
    false,
    (s, i) => spelling(s, i.projectId, i.branch, i.path, i.language),
  );
  tool(
    "fix_spelling",
    "Apply selected check_spelling corrections at the original document revision.",
    {
      ...edit,
      path,
      revisionToken: z.string(),
      corrections: z
        .array(
          z.object({
            start: revision,
            end: revision,
            word: z.string(),
            replacement: z.string().max(200),
          }),
        )
        .min(1)
        .max(300),
    },
    "pushdocs:write",
    true,
    (s, i) => fixSpelling(s, i),
  );
  tool(
    "list_document_images",
    "Inspect working images and their references. Returns hashes required for optimization.",
    { ...context, path },
    "pushdocs:read",
    false,
    (s, i) => documentImages(s, i.projectId, i.branch, i.path),
  );
  const compression = {
    quality: z.number().int().min(1).max(100).optional(),
    maxWidth: z.number().int().min(1).max(10_000).optional(),
    maxHeight: z.number().int().min(1).max(10_000).optional(),
    minSavingsPercent: z.number().min(0).max(100).optional(),
  };
  tool(
    "compress_image",
    "Optimize a shared image asset and stage it. Requires the current content hash. Animated formats are rejected.",
    { ...edit, imagePath: path, expectedHash: z.string().regex(/^[a-f0-9]{64}$/), ...compression },
    "pushdocs:write",
    true,
    (s, i) => compressImage(s, i),
  );
  tool(
    "compress_document_images",
    "Optimize the explicitly reviewed image hashes from list_document_images. Shared assets affect all referencing documents.",
    {
      ...edit,
      path,
      images: z
        .array(z.object({ path, sha256: z.string().regex(/^[a-f0-9]{64}$/) }))
        .min(1)
        .max(20),
      ...compression,
    },
    "pushdocs:write",
    true,
    async (s, i) => {
      await s.document(i.projectId, i.branch, i.path);
      const known = await documentImages(s, i.projectId, i.branch, i.path);
      let expectedRevision = i.expectedRevision;
      const results = [];
      for (const image of i.images) {
        if (!known.images.some((a) => a.path === image.path && a.sha256 === image.sha256))
          throw new McpError("REVISION_CONFLICT", "Image references changed.", 409);
        const result = await compressImage(s, {
          ...i,
          imagePath: image.path,
          expectedHash: image.sha256,
          expectedRevision,
        });
        expectedRevision = result.changeSetRevision;
        results.push(result);
      }
      return { results, changeSetRevision: expectedRevision };
    },
  );
  tool(
    "list_previews",
    "List all project previews, including queued, deployed, running and deleting previews. Returns default branch, creation timestamps, completed startup duration in milliseconds and minutes, idle auto-stop deadline, scheduled workspace deletion, disk bytes, changed file count, stage and assigned URL. An assigned URL does not mean the site is running. Reading this list does not start previews.",
    { projectId, ...paging },
    "pushdocs:read",
    false,
    async (s, i) => {
      const { host } = previewSettings();
      const previews = await s.store.listProjectPreviews(i.projectId);
      return page(
        previews.map((item) => ({
          ...item,
          startupMinutes: item.startupMs === null ? null : item.startupMs / 60_000,
          url: item.port === null ? null : `http://${host}:${item.port}/`,
        })),
        i,
      );
    },
  );
  for (const action of ["start", "status", "stop"] as const)
    tool(
      action === "start"
        ? "start_preview"
        : action === "stop"
          ? "stop_preview"
          : "get_preview_status",
      action === "stop"
        ? "Release this OAuth grant's preview lease. Other clients' leases remain active."
        : "Read/start branch preview. start_preview renews this client's 30-minute lease. running does not alone guarantee content is current.",
      action === "status" ? context : write,
      action === "status" ? "pushdocs:read" : "pushdocs:preview",
      action !== "status",
      async (s, i) => {
        const c = await s.context(i.projectId, i.branch);
        let session = await s.store.getPreviewSession(i.projectId, i.branch);
        const clientId = `mcp:${principal.grantId}`;
        if (action === "start" && process.env.PUSHDOCS_MCP_ALLOW_PUBLIC_PREVIEW !== "1")
          throw new McpError(
            "PREVIEW_ACCESS_POLICY",
            "Preview endpoints are public. The installation operator must explicitly enable MCP public preview.",
            403,
          );
        const portFrom = Number(process.env.PUSHDOCS_PREVIEW_PORT_FROM ?? 43000),
          portTo = Number(process.env.PUSHDOCS_PREVIEW_PORT_TO ?? 43019);
        if (
          !Number.isInteger(portFrom) ||
          !Number.isInteger(portTo) ||
          portFrom < 1024 ||
          portTo > 65535 ||
          portTo < portFrom ||
          portTo - portFrom > 99
        )
          throw new McpError("PREVIEW_FAILED", "Invalid preview port range.");
        if (action === "start")
          session = await s.store.acquirePreview({
            projectId: i.projectId,
            branch: i.branch,
            userId: principal.userId,
            clientId,
            leaseTtlMs: 1_800_000,
            portFrom,
            portTo,
          });
        if (action === "stop" && session) {
          await s.store.releasePreview(session.id, principal.userId, clientId);
          session = await s.store.getPreviewSession(i.projectId, i.branch);
        }
        const host = process.env.PUSHDOCS_PREVIEW_PUBLIC_HOST;
        if (!host || !/^[a-zA-Z0-9.-]+$/.test(host))
          throw new McpError("PREVIEW_FAILED", "Preview public host is not configured.");
        const contentCurrent = session ? await s.store.isPreviewCurrent(session) : false;
        const inventory = (await s.store.listProjectPreviews(i.projectId)).find(
          (item) => item.branch === i.branch,
        );
        const workspace = (await s.store.listPreviewInventory(i.projectId)).find(
          (item) => item.branch === i.branch,
        );
        const lifecycle = previewLifecycle({ session, workspace, contentCurrent });
        return {
          ...c.snapshot,
          inventory: inventory
            ? {
                ...inventory,
                startupMinutes: inventory.startupMs === null ? null : inventory.startupMs / 60_000,
                url: inventory.port === null ? null : `http://${host}:${inventory.port}/`,
              }
            : null,
          status: lifecycle.runtimeStatus,
          stage: session?.log.split("\n").at(-1)?.slice(0, 240),
          previewUrl: lifecycle.canOpen && session ? `http://${host}:${session.port}/` : null,
          appliedSha: session?.head_sha,
          appliedRevision: session?.revision,
          contentCurrent,
          leaseId: session ? `${session.id}:${clientId}` : null,
          expiresAt: action === "start" ? new Date(Date.now() + 1_800_000).toISOString() : null,
          access: "public",
        };
      },
    );
  tool(
    "submit_changes",
    "COMMIT and PUSH the entire reviewed shared change set. create_review also creates a GitHub PR/GitLab MR. Call only when explicitly requested by the user.",
    {
      ...edit,
      changeSetId: z.string().uuid(),
      targetBranch: branch,
      commitMessage: z.string().min(1).max(10_000),
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(reviewDescriptionMaxLength).optional(),
      mode: z.enum(["push_only", "create_review"]),
    },
    "pushdocs:submit",
    true,
    async (s, i) => {
      const c = await s.context(i.projectId, i.branch, "branch:push");
      if (c.snapshot.changeSetId !== i.changeSetId)
        throw new McpError("REVISION_CONFLICT", "Change set changed.", 409);
      if (i.mode === "create_review") {
        await s.store.requireProjectAccess(principal.userId, i.projectId, "change-request:create");
        if (i.branch === i.targetBranch)
          throw new McpError("INVALID_ARGUMENT", "Review source and target branches must differ.");
      }
      const operationId = await s.store.queueChangeSetSubmission({
        ...i,
        userId: principal.userId,
        message: i.commitMessage,
        createReview: i.mode === "create_review",
        oauthGrantId: principal.grantId,
      });
      return { operationId, status: "queued", changeSetId: i.changeSetId };
    },
  );
  return server;
}
