import {
  assertProjectFileEditable,
  buildLinkIndex,
  editNavigation,
  type NavigationPosition,
  navigationTree,
  parseNavigation,
  parseProjectConfig,
  planTemplate,
  safePath,
  searchDocuments,
} from "@pushdocs/content";
import { patchMetadata, readMetadata } from "@pushdocs/content/metadata";
import { McpError, type PushDocsRepository, tokenDigest } from "@pushdocs/db";
import type { ProjectAction } from "@pushdocs/domain";
import { providerForConnection } from "./provider";

const linkIndexes = new Map<string, ReturnType<typeof buildLinkIndex>>();
export class ProjectService {
  constructor(
    readonly store: PushDocsRepository,
    readonly userId: string,
  ) {}
  async context(projectId: string, branch: string, action: ProjectAction = "project:read") {
    const access = await this.store.requireProjectAccess(this.userId, projectId, action);
    const state = await this.store.listWorkingFiles(projectId, branch);
    const config = parseProjectConfig(
      state.files.find((f) => f.path === ".pushdocs/config.json" && f.status !== "delete")?.content,
    );
    const snapshot = {
      branch,
      headCommitSha: state.branch.head_commit_sha,
      changeSetId: state.changeSet?.id ?? null,
      changeSetRevision: state.changeSet?.revision ?? 0,
    };
    return { access, state, config, snapshot };
  }
  documents(context: Awaited<ReturnType<ProjectService["context"]>>) {
    return context.state.files.filter(
      (f) =>
        f.status !== "delete" &&
        /\.mdx?$/i.test(f.path) &&
        context.config.documentRoots.some((root) => f.path.startsWith(`${root}/`)),
    );
  }
  async document(projectId: string, branch: string, filePath: string) {
    const context = await this.context(projectId, branch);
    safePath(filePath);
    const file = this.documents(context).find((f) => f.path === filePath);
    if (!file) throw new McpError("DOCUMENT_NOT_FOUND", "Document not found.", 404);
    return {
      ...context,
      file,
      revisionToken: tokenDigest(JSON.stringify(context.snapshot) + file.content),
    };
  }
  async stage(input: {
    projectId: string;
    branch: string;
    expectedRevision: number;
    expectedHeadSha?: string;
    files: Array<{ path: string; content: string | null; createOnly?: boolean }>;
  }) {
    const context = await this.context(input.projectId, input.branch, "document:write");
    for (const file of input.files) {
      assertProjectFileEditable(context.config, file.path, context.access.role);
      if (file.path === ".pushdocs/config.json" && file.content) parseProjectConfig(file.content);
    }
    const result = await this.store.stageFiles({
      ...input,
      userId: this.userId,
      expectedHeadSha: input.expectedHeadSha ?? context.snapshot.headCommitSha,
    });
    return { ...result, affectedFiles: input.files.map((file) => file.path) };
  }
  async create(input: {
    projectId: string;
    branch: string;
    path: string;
    content: string;
    title?: string;
    frontmatter?: Record<string, string | number | boolean>;
    expectedRevision: number;
  }) {
    const context = await this.context(input.projectId, input.branch, "document:write");
    if (
      !/\.mdx?$/i.test(input.path) ||
      !context.config.documentRoots.some((r) => input.path.startsWith(`${r}/`))
    )
      throw new McpError("INVALID_ARGUMENT", "Document path must be inside a document root.");
    const content = patchMetadata(input.content, {
      ...input.frontmatter,
      ...(input.title ? { title: input.title } : {}),
    });
    return this.stage({
      ...input,
      expectedHeadSha: context.snapshot.headCommitSha,
      files: [{ path: input.path, content, createOnly: true }],
    });
  }
  async update(input: {
    projectId: string;
    branch: string;
    path: string;
    content: string;
    revisionToken: string;
    expectedRevision: number;
  }) {
    const current = await this.document(input.projectId, input.branch, input.path);
    if (current.revisionToken !== input.revisionToken)
      throw new McpError(
        "REVISION_CONFLICT",
        "Document changed. Reload it before applying corrections.",
        409,
      );
    return this.stage({
      ...input,
      expectedHeadSha: current.snapshot.headCommitSha,
      files: [{ path: input.path, content: input.content }],
    });
  }
  async template(input: {
    projectId: string;
    branch: string;
    templateId: string;
    values: Record<string, string>;
    expectedRevision: number;
    planDigest?: string;
    apply: boolean;
  }) {
    const context = await this.context(
      input.projectId,
      input.branch,
      input.apply ? "document:write" : "project:read",
    );
    const files = planTemplate(
      context.config,
      input.templateId,
      input.values,
      new Map(
        context.state.files.filter((f) => f.status !== "delete").map((f) => [f.path, f.content]),
      ),
    );
    for (const file of files)
      assertProjectFileEditable(context.config, file.path, context.access.role);
    const planDigest = tokenDigest(JSON.stringify({ files, snapshot: context.snapshot }));
    if (!input.apply) return { files, planDigest, ...context.snapshot };
    if (planDigest !== input.planDigest)
      throw new McpError("REVISION_CONFLICT", "Template plan changed. Review it again.", 409);
    return this.stage({ ...input, expectedHeadSha: context.snapshot.headCommitSha, files });
  }
  async project(projectId: string, branch?: string) {
    await this.store.requireProjectAccess(this.userId, projectId);
    const project = (await this.store.listProjects(this.userId)).find((p) => p.id === projectId);
    if (!project) throw new McpError("PROJECT_NOT_FOUND", "Project not found.", 404);
    const context = await this.context(projectId, branch ?? project.defaultBranch);
    const target = await this.store.getProjectSyncTarget(projectId);
    return {
      ...project,
      config: context.config,
      repository: target
        ? { provider: target.kind, name: target.provider_repository_id, root: target.root_path }
        : null,
      ...context.snapshot,
      sharedChangeSet: true,
    };
  }
  async search(projectId: string, branch: string, query: string, topic: boolean) {
    const context = await this.context(projectId, branch);
    return {
      ...context.snapshot,
      method: topic ? "lexical-topic" : "literal",
      results: searchDocuments(this.documents(context), query, topic),
    };
  }
  async backlinks(projectId: string, branch: string, filePath: string) {
    const context = await this.document(projectId, branch, filePath),
      documents = this.documents(context);
    const key = tokenDigest(
      JSON.stringify(context.snapshot) +
        documents.map((d) => tokenDigest(d.content) + d.path + d.locale + d.version).join(""),
    );
    let index = linkIndexes.get(key);
    if (!index) {
      index = buildLinkIndex(documents);
      if (documents.reduce((size, doc) => size + doc.content.length, 0) < 16_000_000) {
        linkIndexes.set(key, index);
        while (linkIndexes.size > 4) {
          const oldest = linkIndexes.keys().next().value;
          if (oldest) linkIndexes.delete(oldest);
          else break;
        }
      }
    }
    return {
      ...context.snapshot,
      incoming: index.incoming.get(filePath) ?? [],
      unresolved: index.unresolved,
    };
  }
  async navigation(projectId: string, branch: string, filePath: string) {
    const context = await this.context(projectId, branch);
    safePath(filePath);
    const file = context.state.files.find((f) => f.path === filePath && f.status !== "delete");
    if (!file || !context.config.editableFiles.includes(filePath))
      throw new McpError(
        "UNSUPPORTED_NAVIGATION_FORMAT",
        "Navigation must be an imported editable sidebar file.",
      );
    return { ...context, file, tree: navigationTree(parseNavigation(file.content).value) };
  }
  async editNavigation(input: {
    projectId: string;
    branch: string;
    path: string;
    expectedRevision: number;
    action: "add" | "move" | "remove";
    document?: string;
    item?: string;
    parent?: string;
    position?: NavigationPosition;
  }) {
    const context = await this.navigation(input.projectId, input.branch, input.path);
    let document = input.document;
    if (document) {
      const article = await this.document(input.projectId, input.branch, document);
      const id = readMetadata(article.file.content).values.id;
      const root = [...context.config.documentRoots]
        .sort((a, b) => b.length - a.length)
        .find((root) => document?.startsWith(`${root}/`));
      document =
        typeof id === "string"
          ? id
          : document.slice((root?.length ?? -1) + 1).replace(/\.mdx?$/i, "");
    }
    const content = editNavigation(context.file.content, { ...input, document });
    return this.stage({
      ...input,
      expectedHeadSha: context.snapshot.headCommitSha,
      files: [{ path: input.path, content }],
    });
  }
  async branchChanges(projectId: string, branch: string, baseBranch: string) {
    const context = await this.context(projectId, branch),
      base = await this.context(projectId, baseBranch);
    const target = await this.store.getProjectSyncTarget(projectId);
    if (!target) throw new McpError("PROJECT_NOT_FOUND", "Project not found.");
    const provider = await providerForConnection(target);
    if (!provider.compareFiles)
      throw new McpError("PROVIDER_ERROR", "Provider does not support comparison.");
    const files = await provider.compareFiles(
      target.provider_repository_id,
      base.snapshot.headCommitSha,
      context.snapshot.headCommitSha,
    );
    return { ...context.snapshot, baseBranch, baseCommitSha: base.snapshot.headCommitSha, files };
  }
}
