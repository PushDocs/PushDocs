import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { analyzeContent } from "@pushdocs/content";
import { readMetadata } from "@pushdocs/content/metadata";
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
import { compressImage, documentImages, fixSpelling, spelling } from "./quality";

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
]);
export function scopeForTool(name: string) {
  return toolScopes[name];
}
export function createMcpServer(principal: McpPrincipal, db = getDatabase()) {
  const server = new McpServer(
    { name: "PushDocs", version: "0.1.0" },
    {
      instructions:
        "PushDocs manages documentation stored in Git repositories. Read/search before editing. Change sets are shared by all project users on a branch. Create a branch for your task. Reload after revision conflicts. Review the complete change set before submitting. Only submit when the user explicitly requests commit/push/PR/MR. Preview when appropriate. Poll operation IDs until completion.",
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
          readOnlyHint: !mutates,
          destructiveHint: mutates,
          idempotentHint: true,
          openWorldHint: [
            "create_branch",
            "submit_changes",
            "start_preview",
            "get_branch_changes",
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
    "Read project configuration, roots, templates and branch snapshot. Credentials are never returned.",
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
    "Read branch creation or submission job status for an accessible project.",
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
    "List all project previews, including queued, deployed, running and deleting previews. Returns default branch, creation timestamps, completed startup duration in milliseconds and minutes, scheduled workspace deletion, disk bytes, changed file count, stage and assigned URL. An assigned URL does not mean the site is running. Reading this list does not start previews.",
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
      description: z.string().max(30_000).optional(),
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
