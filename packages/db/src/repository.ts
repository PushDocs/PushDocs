import { createHash, randomBytes } from "node:crypto";
import type {
  DocumentSummary,
  ProjectRole,
  ProjectSummary,
  ProviderKind,
} from "@pushdocs/contracts";
import { assertCan, normalizeBranchRef, type ProjectAction } from "@pushdocs/domain";
import type { Kysely } from "kysely";
import { appendEvent } from "./events";
import type { Database } from "./schema";

export class RevisionConflictError extends Error {
  readonly code = "REVISION_CONFLICT";
}

export class NotFoundError extends Error {
  readonly code = "NOT_FOUND";
}

export interface ProjectAccess {
  projectId: string;
  role: ProjectRole;
}

function titleFromDraft(content: string | null, documentPath: string): string {
  const heading = content?.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return (
    documentPath
      .split("/")
      .at(-1)
      ?.replace(/\.(md|mdx)$/i, "")
      .replace(/[-_]/g, " ") ?? documentPath
  );
}

export class PushDocsRepository {
  constructor(private readonly database: Kysely<Database>) {}

  async isBootstrapped(): Promise<boolean> {
    const row = await this.database
      .selectFrom("users")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("is_instance_operator", "=", true)
      .executeTakeFirstOrThrow();
    return Number(row.count) > 0;
  }

  async createOperator(input: {
    displayName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ id: string }> {
    return this.database.transaction().execute(async (transaction) => {
      const existing = await transaction
        .selectFrom("users")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("is_instance_operator", "=", true)
        .executeTakeFirstOrThrow();
      if (Number(existing.count) > 0) throw new RevisionConflictError("Setup is complete");
      return transaction
        .insertInto("users")
        .values({
          display_name: input.displayName,
          email: input.email,
          is_instance_operator: true,
          password_hash: input.passwordHash,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
    });
  }

  async findUserByEmail(email: string) {
    return this.database
      .selectFrom("users")
      .selectAll()
      .where("email", "=", email)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  async createUser(input: {
    displayName: string;
    email: string;
    passwordHash: string;
  }): Promise<{ id: string }> {
    return this.database
      .insertInto("users")
      .values({
        display_name: input.displayName,
        email: input.email,
        password_hash: input.passwordHash,
      })
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  async findUserBySessionHash(tokenHash: string) {
    return this.database
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .select([
        "users.id",
        "users.display_name",
        "users.email",
        "users.is_instance_operator",
        "users.status",
        "sessions.expires_at",
      ])
      .where("sessions.token_hash", "=", tokenHash)
      .where("sessions.expires_at", ">", new Date())
      .where("users.status", "=", "active")
      .executeTakeFirst();
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.database
      .insertInto("sessions")
      .values({ expires_at: expiresAt, token_hash: tokenHash, user_id: userId })
      .execute();
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.deleteFrom("sessions").where("token_hash", "=", tokenHash).execute();
  }

  async requireProjectAccess(
    userId: string,
    projectId: string,
    action: ProjectAction = "project:read",
  ): Promise<ProjectAccess> {
    const membership = await this.database
      .selectFrom("project_memberships")
      .select(["project_id", "role"])
      .where("project_id", "=", projectId)
      .where("user_id", "=", userId)
      .executeTakeFirst();
    if (!membership) throw new NotFoundError("Project not found");
    assertCan(membership.role, action);
    return { projectId: membership.project_id, role: membership.role };
  }

  async listProjects(userId: string): Promise<ProjectSummary[]> {
    const rows = await this.database
      .selectFrom("projects")
      .innerJoin("project_memberships", "project_memberships.project_id", "projects.id")
      .innerJoin("repositories", "repositories.id", "projects.repository_id")
      .innerJoin("provider_connections", "provider_connections.id", "repositories.connection_id")
      .select([
        "projects.id",
        "projects.slug",
        "projects.name",
        "projects.default_branch",
        "projects.updated_at",
        "projects.status",
        "project_memberships.role",
        "provider_connections.kind",
        "provider_connections.name as provider_name",
      ])
      .where("project_memberships.user_id", "=", userId)
      .where("projects.status", "!=", "archived")
      .orderBy("projects.name")
      .execute();
    const counts = await this.database
      .selectFrom("change_requests")
      .select(["project_id"])
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("state", "=", "open")
      .groupBy("project_id")
      .execute();
    const openByProject = new Map(counts.map((row) => [row.project_id, Number(row.count)]));
    return rows.map((row) => ({
      defaultBranch: row.default_branch,
      id: row.id,
      name: row.name,
      openChangeRequests: openByProject.get(row.id) ?? 0,
      provider: row.kind as ProviderKind,
      providerLabel: row.provider_name,
      role: row.role,
      slug: row.slug,
      syncStatus: row.status === "attention" ? "attention" : "current",
      updatedAt: new Date(row.updated_at).toISOString(),
    }));
  }

  async listConnections() {
    return this.database
      .selectFrom("provider_connections")
      .select(["id", "name", "kind", "base_url", "updated_at"])
      .orderBy("name")
      .execute();
  }

  async getConnection(connectionId: string) {
    return this.database
      .selectFrom("provider_connections")
      .select(["id", "base_url", "kind", "secret_encrypted"])
      .where("id", "=", connectionId)
      .executeTakeFirst();
  }

  async createConnection(input: {
    baseUrl: string;
    kind: ProviderKind;
    name: string;
    secretEncrypted: string;
  }) {
    return this.database
      .insertInto("provider_connections")
      .values({
        base_url: input.baseUrl,
        kind: input.kind,
        name: input.name,
        secret_encrypted: input.secretEncrypted,
      })
      .returning(["id", "name", "kind", "base_url"])
      .executeTakeFirstOrThrow();
  }

  async createProject(input: {
    connectionId: string;
    defaultBranch: string;
    name: string;
    operatorUserId: string;
    repositoryFullName: string;
    repositoryProviderId: string;
    repositoryUrl: string;
    rootPath: string;
    slug: string;
  }) {
    return this.database.transaction().execute(async (transaction) => {
      const repository = await transaction
        .insertInto("repositories")
        .values({
          clone_url: input.repositoryUrl,
          connection_id: input.connectionId,
          default_branch: normalizeBranchRef(input.defaultBranch),
          full_name: input.repositoryFullName,
          provider_repository_id: input.repositoryProviderId,
        })
        .onConflict((conflict) =>
          conflict.columns(["connection_id", "provider_repository_id"]).doUpdateSet({
            clone_url: input.repositoryUrl,
            default_branch: normalizeBranchRef(input.defaultBranch),
            full_name: input.repositoryFullName,
          }),
        )
        .returning("id")
        .executeTakeFirstOrThrow();
      const project = await transaction
        .insertInto("projects")
        .values({
          default_branch: normalizeBranchRef(input.defaultBranch),
          name: input.name,
          repository_id: repository.id,
          root_path: input.rootPath || ".",
          slug: input.slug,
        })
        .returning(["id", "slug", "name"])
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("project_memberships")
        .values({ project_id: project.id, role: "admin", user_id: input.operatorUserId })
        .execute();
      await transaction
        .insertInto("project_connection_grants")
        .values({
          connection_id: input.connectionId,
          project_id: project.id,
          repository_id: repository.id,
        })
        .execute();
      await transaction
        .insertInto("jobs")
        .values({ kind: "project.sync", payload: { projectId: project.id } })
        .execute();
      await appendEvent(transaction, {
        entityId: project.id,
        projectId: project.id,
        revision: 1,
        type: "project.created",
      });
      return project;
    });
  }

  async getProjectSyncTarget(projectId: string) {
    return this.database
      .selectFrom("projects")
      .innerJoin("repositories", "repositories.id", "projects.repository_id")
      .innerJoin("provider_connections", "provider_connections.id", "repositories.connection_id")
      .innerJoin("project_connection_grants", (join) =>
        join
          .onRef("project_connection_grants.project_id", "=", "projects.id")
          .onRef("project_connection_grants.repository_id", "=", "repositories.id")
          .onRef("project_connection_grants.connection_id", "=", "provider_connections.id"),
      )
      .select([
        "projects.id as project_id",
        "projects.default_branch",
        "projects.root_path",
        "repositories.provider_repository_id",
        "provider_connections.base_url",
        "provider_connections.kind",
        "provider_connections.secret_encrypted",
      ])
      .where("projects.id", "=", projectId)
      .where("projects.status", "!=", "archived")
      .executeTakeFirst();
  }

  async listActiveProjectIds(): Promise<string[]> {
    const rows = await this.database
      .selectFrom("projects")
      .select("id")
      .where("status", "!=", "archived")
      .orderBy("updated_at", "desc")
      .execute();
    return rows.map((row) => row.id);
  }

  async replaceImportedDocuments(
    projectId: string,
    branchName: string,
    headSha: string,
    documents: Array<{
      content: string;
      contentHash: string;
      locale: string;
      path: string;
      title: string;
      version: string;
    }>,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const fullRef = normalizeBranchRef(branchName);
      let branch = await transaction
        .selectFrom("branch_contexts")
        .selectAll()
        .where("project_id", "=", projectId)
        .where("full_ref", "=", fullRef)
        .orderBy("generation", "desc")
        .executeTakeFirst();
      if (!branch) {
        branch = await transaction
          .insertInto("branch_contexts")
          .values({
            base_commit_sha: headSha,
            full_ref: fullRef,
            head_commit_sha: headSha,
            project_id: projectId,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
      } else {
        branch = await transaction
          .updateTable("branch_contexts")
          .set({ head_commit_sha: headSha, updated_at: new Date() })
          .where("id", "=", branch.id)
          .returningAll()
          .executeTakeFirstOrThrow();
      }
      await transaction
        .deleteFrom("imported_documents")
        .where("branch_context_id", "=", branch.id)
        .execute();
      for (let offset = 0; offset < documents.length; offset += 250) {
        const batch = documents.slice(offset, offset + 250);
        if (batch.length === 0) continue;
        await transaction
          .insertInto("imported_documents")
          .values(
            batch.map((document) => ({
              branch_context_id: branch.id,
              content: document.content,
              content_hash: document.contentHash,
              locale: document.locale,
              path: document.path,
              project_id: projectId,
              title: document.title,
              version: document.version,
            })),
          )
          .execute();
      }
      await transaction
        .updateTable("projects")
        .set({ status: "active", updated_at: new Date() })
        .where("id", "=", projectId)
        .execute();
      await appendEvent(transaction, {
        entityId: branch.id,
        payload: { branch: branchName, documentCount: documents.length, headSha },
        projectId,
        revision: 1,
        type: "branch.synchronized",
      });
    });
  }

  async claimNextJob() {
    return this.database.transaction().execute(async (transaction) => {
      const job = await transaction
        .selectFrom("jobs")
        .selectAll()
        .where("status", "=", "queued")
        .where("available_at", "<=", new Date())
        .orderBy("created_at")
        .forUpdate()
        .skipLocked()
        .executeTakeFirst();
      if (!job) return undefined;
      return transaction
        .updateTable("jobs")
        .set({
          attempts: job.attempts + 1,
          locked_at: new Date(),
          status: "running",
          updated_at: new Date(),
        })
        .where("id", "=", job.id)
        .returningAll()
        .executeTakeFirstOrThrow();
    });
  }

  async completeJob(jobId: string): Promise<void> {
    await this.database
      .updateTable("jobs")
      .set({ locked_at: null, status: "done", updated_at: new Date() })
      .where("id", "=", jobId)
      .execute();
  }

  async failJob(jobId: string, error: string, retry: boolean): Promise<void> {
    await this.database
      .updateTable("jobs")
      .set({
        available_at: new Date(Date.now() + 30_000),
        last_error: error.slice(0, 4000),
        locked_at: null,
        status: retry ? "queued" : "failed",
        updated_at: new Date(),
      })
      .where("id", "=", jobId)
      .execute();
  }

  async markProjectAttention(projectId: string): Promise<void> {
    await this.database
      .updateTable("projects")
      .set({ status: "attention", updated_at: new Date() })
      .where("id", "=", projectId)
      .execute();
  }

  async ensureBranch(projectId: string, branch: string, headSha: string) {
    const fullRef = normalizeBranchRef(branch);
    const existing = await this.database
      .selectFrom("branch_contexts")
      .selectAll()
      .where("project_id", "=", projectId)
      .where("full_ref", "=", fullRef)
      .orderBy("generation", "desc")
      .executeTakeFirst();
    if (existing) return existing;
    return this.database
      .insertInto("branch_contexts")
      .values({
        base_commit_sha: headSha,
        full_ref: fullRef,
        head_commit_sha: headSha,
        project_id: projectId,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async ensureBranches(
    projectId: string,
    branches: Array<{ name: string; sha: string }>,
  ): Promise<void> {
    if (branches.length === 0) return;
    await this.database
      .insertInto("branch_contexts")
      .values(
        branches.map((branch) => ({
          base_commit_sha: branch.sha,
          full_ref: normalizeBranchRef(branch.name),
          head_commit_sha: branch.sha,
          project_id: projectId,
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(["project_id", "full_ref", "generation"]).doNothing(),
      )
      .execute();
  }

  async enqueueBranchSync(projectId: string, branch: string): Promise<void> {
    await this.database
      .insertInto("jobs")
      .values({ kind: "branch.sync", payload: { branch, projectId } })
      .execute();
  }

  async listBranches(projectId: string) {
    return this.database
      .selectFrom("branch_contexts")
      .select(["id", "full_ref", "head_commit_sha", "updated_at"])
      .where("project_id", "=", projectId)
      .orderBy("updated_at", "desc")
      .execute();
  }

  async ensureProjectComponents(projectId: string, names: string[]): Promise<void> {
    if (names.length === 0) return;
    await this.database
      .insertInto("project_components")
      .values(
        names.map((name) => ({
          description: "Найден при импорте MDX. Настройте шаблон перед использованием.",
          label: name,
          name,
          project_id: projectId,
          snippet: `<${name} />`,
          source: "detected" as const,
        })),
      )
      .onConflict((conflict) => conflict.columns(["project_id", "name"]).doNothing())
      .execute();
  }

  async listProjectComponents(projectId: string) {
    return this.database
      .selectFrom("project_components")
      .select(["id", "name", "label", "description", "snippet", "source"])
      .where("project_id", "=", projectId)
      .orderBy("label")
      .execute();
  }

  async createProjectComponent(input: {
    description: string;
    label: string;
    name: string;
    projectId: string;
    snippet: string;
  }) {
    return this.database
      .insertInto("project_components")
      .values({
        description: input.description,
        label: input.label,
        name: input.name,
        project_id: input.projectId,
        snippet: input.snippet,
        source: "manual",
      })
      .onConflict((conflict) =>
        conflict.columns(["project_id", "name"]).doUpdateSet({
          description: input.description,
          label: input.label,
          snippet: input.snippet,
          source: "manual",
          updated_at: new Date(),
        }),
      )
      .returning("id")
      .executeTakeFirstOrThrow();
  }

  async listDocuments(projectId: string, branch: string): Promise<DocumentSummary[]> {
    const rows = await this.database
      .selectFrom("imported_documents")
      .innerJoin("branch_contexts", "branch_contexts.id", "imported_documents.branch_context_id")
      .leftJoin("change_sets", (join) =>
        join
          .onRef("change_sets.branch_context_id", "=", "branch_contexts.id")
          .on("change_sets.status", "in", ["open", "conflicted", "submitting"]),
      )
      .leftJoin("draft_files", (join) =>
        join
          .onRef("draft_files.change_set_id", "=", "change_sets.id")
          .onRef("draft_files.path", "=", "imported_documents.path"),
      )
      .select([
        "imported_documents.path",
        "imported_documents.title",
        "imported_documents.locale",
        "imported_documents.version",
        "draft_files.operation",
      ])
      .where("imported_documents.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .orderBy("imported_documents.path")
      .execute();
    const imported: DocumentSummary[] = rows.map((row) => ({
      locale: row.locale,
      path: row.path,
      status:
        row.operation === "add"
          ? "added"
          : row.operation === "delete"
            ? "deleted"
            : row.operation
              ? "modified"
              : "clean",
      title: row.title,
      version: row.version,
    }));
    const added = await this.database
      .selectFrom("draft_files")
      .innerJoin("change_sets", "change_sets.id", "draft_files.change_set_id")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .leftJoin("imported_documents", (join) =>
        join
          .onRef("imported_documents.branch_context_id", "=", "branch_contexts.id")
          .onRef("imported_documents.path", "=", "draft_files.path"),
      )
      .select(["draft_files.content", "draft_files.path"])
      .where("change_sets.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("change_sets.status", "in", ["open", "conflicted", "submitting"])
      .where("draft_files.operation", "=", "add")
      .where("imported_documents.path", "is", null)
      .execute();
    for (const row of added) {
      imported.push({
        locale: "default",
        path: row.path,
        status: "added",
        title: titleFromDraft(row.content, row.path),
        version: "current",
      });
    }
    return imported.sort((left, right) => left.path.localeCompare(right.path));
  }

  async getDocument(projectId: string, branch: string, documentPath: string) {
    const imported = await this.database
      .selectFrom("imported_documents")
      .innerJoin("branch_contexts", "branch_contexts.id", "imported_documents.branch_context_id")
      .leftJoin("change_sets", (join) =>
        join
          .onRef("change_sets.branch_context_id", "=", "branch_contexts.id")
          .on("change_sets.status", "in", ["open", "conflicted", "submitting"]),
      )
      .leftJoin("draft_files", (join) =>
        join
          .onRef("draft_files.change_set_id", "=", "change_sets.id")
          .onRef("draft_files.path", "=", "imported_documents.path"),
      )
      .select([
        "branch_contexts.id as branch_context_id",
        "branch_contexts.head_commit_sha",
        "imported_documents.content as source_content",
        "imported_documents.locale",
        "imported_documents.path",
        "imported_documents.title",
        "imported_documents.version",
        "draft_files.content as draft_content",
        "draft_files.revision as draft_revision",
        "change_sets.status as change_set_status",
      ])
      .where("imported_documents.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("imported_documents.path", "=", documentPath)
      .executeTakeFirst();
    if (imported) return imported;
    const added = await this.database
      .selectFrom("draft_files")
      .innerJoin("change_sets", "change_sets.id", "draft_files.change_set_id")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .select([
        "branch_contexts.id as branch_context_id",
        "branch_contexts.head_commit_sha",
        "draft_files.content as draft_content",
        "draft_files.revision as draft_revision",
        "draft_files.path",
        "change_sets.status as change_set_status",
      ])
      .where("change_sets.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("change_sets.status", "in", ["open", "conflicted", "submitting"])
      .where("draft_files.path", "=", documentPath)
      .where("draft_files.operation", "=", "add")
      .executeTakeFirst();
    if (!added) return undefined;
    return {
      ...added,
      locale: "default",
      source_content: "",
      title: titleFromDraft(added.draft_content, added.path),
      version: "current",
    };
  }

  async createDraftDocument(input: {
    branch: string;
    content: string;
    path: string;
    projectId: string;
    userId: string;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const branch = await transaction
        .selectFrom("branch_contexts")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("full_ref", "=", normalizeBranchRef(input.branch))
        .orderBy("generation", "desc")
        .executeTakeFirst();
      if (!branch) throw new NotFoundError("Branch not found");
      const existing = await transaction
        .selectFrom("imported_documents")
        .select("path")
        .where("branch_context_id", "=", branch.id)
        .where("path", "=", input.path)
        .executeTakeFirst();
      if (existing) throw new RevisionConflictError("Document already exists");
      let changeSet = await transaction
        .selectFrom("change_sets")
        .selectAll()
        .where("branch_context_id", "=", branch.id)
        .where("status", "in", ["open", "conflicted"])
        .executeTakeFirst();
      changeSet ??= await transaction
        .insertInto("change_sets")
        .values({
          base_commit_sha: branch.head_commit_sha,
          branch_context_id: branch.id,
          project_id: input.projectId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("draft_files")
        .values({
          author_user_id: input.userId,
          change_set_id: changeSet.id,
          content: input.content,
          operation: "add",
          path: input.path,
        })
        .execute();
      await transaction
        .updateTable("change_sets")
        .set({ revision: changeSet.revision + 1, updated_at: new Date() })
        .where("id", "=", changeSet.id)
        .execute();
      await appendEvent(transaction, {
        entityId: input.path,
        payload: { branch: input.branch },
        projectId: input.projectId,
        revision: 1,
        type: "document.created",
      });
    });
  }

  async saveDraft(input: {
    baseCommitSha: string;
    branch: string;
    content: string;
    expectedRevision: number;
    path: string;
    projectId: string;
    userId: string;
  }) {
    return this.database.transaction().execute(async (transaction) => {
      const branch = await transaction
        .selectFrom("branch_contexts")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("full_ref", "=", normalizeBranchRef(input.branch))
        .orderBy("generation", "desc")
        .executeTakeFirst();
      if (!branch) throw new NotFoundError("Branch not found");
      let changeSet = await transaction
        .selectFrom("change_sets")
        .selectAll()
        .where("branch_context_id", "=", branch.id)
        .where("status", "in", ["open", "conflicted"])
        .executeTakeFirst();
      changeSet ??= await transaction
        .insertInto("change_sets")
        .values({
          base_commit_sha: input.baseCommitSha,
          branch_context_id: branch.id,
          project_id: input.projectId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const current = await transaction
        .selectFrom("draft_files")
        .select(["revision"])
        .where("change_set_id", "=", changeSet.id)
        .where("path", "=", input.path)
        .forUpdate()
        .executeTakeFirst();
      const currentRevision = current?.revision ?? 0;
      if (currentRevision !== input.expectedRevision) {
        throw new RevisionConflictError("The document changed after it was opened");
      }
      const revision = currentRevision + 1;
      await transaction
        .insertInto("draft_files")
        .values({
          author_user_id: input.userId,
          change_set_id: changeSet.id,
          content: input.content,
          operation: "modify",
          path: input.path,
          revision,
        })
        .onConflict((conflict) =>
          conflict.columns(["change_set_id", "path"]).doUpdateSet({
            author_user_id: input.userId,
            content: input.content,
            revision,
            updated_at: new Date(),
          }),
        )
        .execute();
      await transaction
        .updateTable("change_sets")
        .set({ revision: changeSet.revision + 1, updated_at: new Date() })
        .where("id", "=", changeSet.id)
        .execute();
      await appendEvent(transaction, {
        entityId: input.path,
        payload: { branch: input.branch },
        projectId: input.projectId,
        revision,
        type: "document.draft-saved",
      });
      return { changeSetId: changeSet.id, revision };
    });
  }

  async listComments(projectId: string, branch: string, documentPath: string) {
    return this.database
      .selectFrom("discussions")
      .innerJoin("branch_contexts", "branch_contexts.id", "discussions.branch_context_id")
      .innerJoin("comments", "comments.discussion_id", "discussions.id")
      .innerJoin("users", "users.id", "comments.author_user_id")
      .select([
        "discussions.id as discussion_id",
        "discussions.anchor_quote",
        "discussions.resolved_at",
        "comments.id",
        "comments.body",
        "comments.created_at",
        "users.display_name as author_name",
      ])
      .where("discussions.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("discussions.document_path", "=", documentPath)
      .orderBy("comments.created_at")
      .execute();
  }

  async createComment(input: {
    anchorQuote: string | null;
    body: string;
    branch: string;
    documentPath: string;
    projectId: string;
    userId: string;
  }) {
    return this.database.transaction().execute(async (transaction) => {
      const branch = await transaction
        .selectFrom("branch_contexts")
        .select("id")
        .where("project_id", "=", input.projectId)
        .where("full_ref", "=", normalizeBranchRef(input.branch))
        .orderBy("generation", "desc")
        .executeTakeFirst();
      if (!branch) throw new NotFoundError("Branch not found");
      const discussion = await transaction
        .insertInto("discussions")
        .values({
          anchor_quote: input.anchorQuote,
          branch_context_id: branch.id,
          document_path: input.documentPath,
          project_id: input.projectId,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      const comment = await transaction
        .insertInto("comments")
        .values({
          author_user_id: input.userId,
          body: input.body,
          discussion_id: discussion.id,
        })
        .returning(["id", "created_at"])
        .executeTakeFirstOrThrow();
      await appendEvent(transaction, {
        entityId: discussion.id,
        payload: { branch: input.branch, documentPath: input.documentPath },
        projectId: input.projectId,
        revision: 1,
        type: "comment.created",
      });
      return { ...comment, discussionId: discussion.id };
    });
  }

  async listChangeRequests(projectId: string) {
    return this.database
      .selectFrom("change_requests")
      .selectAll()
      .where("project_id", "=", projectId)
      .orderBy("updated_at", "desc")
      .execute();
  }

  async replaceChangeRequests(
    projectId: string,
    requests: Array<{
      checks: Array<{
        conclusion: "success" | "failure" | "neutral" | "skipped" | "running";
        durationMs: number | null;
        id: string;
        name: string;
        required: boolean;
        url: string | null;
      }>;
      externalId: string;
      headSha: string;
      sourceBranch: string;
      state: "open" | "merged" | "closed";
      targetBranch: string;
      title: string;
      url: string;
    }>,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      await transaction
        .updateTable("change_requests")
        .set({ state: "closed", updated_at: new Date() })
        .where("project_id", "=", projectId)
        .where("state", "=", "open")
        .execute();
      for (const request of requests) {
        const stored = await transaction
          .insertInto("change_requests")
          .values({
            external_id: request.externalId,
            head_sha: request.headSha,
            project_id: projectId,
            provider_url: request.url,
            source_branch: request.sourceBranch,
            state: request.state,
            target_branch: request.targetBranch,
            title: request.title,
          })
          .onConflict((conflict) =>
            conflict.columns(["project_id", "external_id"]).doUpdateSet({
              head_sha: request.headSha,
              provider_url: request.url,
              source_branch: request.sourceBranch,
              state: request.state,
              target_branch: request.targetBranch,
              title: request.title,
              updated_at: new Date(),
            }),
          )
          .returning("id")
          .executeTakeFirstOrThrow();
        await transaction
          .deleteFrom("check_runs")
          .where("change_request_id", "=", stored.id)
          .execute();
        if (request.checks.length > 0) {
          await transaction
            .insertInto("check_runs")
            .values(
              request.checks.map((check) => ({
                change_request_id: stored.id,
                conclusion: check.conclusion,
                duration_ms: check.durationMs,
                external_id: check.id,
                name: check.name,
                required: check.required,
                url: check.url,
              })),
            )
            .execute();
        }
      }
      await appendEvent(transaction, {
        entityId: projectId,
        payload: { changeRequestCount: requests.length },
        projectId,
        revision: 1,
        type: "reviews.synchronized",
      });
    });
  }

  async listDraftFiles(projectId: string, branch: string) {
    return this.database
      .selectFrom("draft_files")
      .innerJoin("change_sets", "change_sets.id", "draft_files.change_set_id")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .innerJoin("users", "users.id", "draft_files.author_user_id")
      .select([
        "change_sets.id as change_set_id",
        "change_sets.base_commit_sha",
        "change_sets.revision as change_set_revision",
        "change_sets.status",
        "draft_files.path",
        "draft_files.operation",
        "draft_files.revision",
        "draft_files.updated_at",
        "users.display_name as author_name",
      ])
      .where("change_sets.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("change_sets.status", "in", ["open", "conflicted", "submitting"])
      .orderBy("draft_files.updated_at", "desc")
      .execute();
  }

  async listChecks(changeRequestId: string) {
    return this.database
      .selectFrom("check_runs")
      .selectAll()
      .where("change_request_id", "=", changeRequestId)
      .orderBy("name")
      .execute();
  }

  async listAttachments(projectId: string) {
    return this.database
      .selectFrom("attachments")
      .innerJoin("change_sets", "change_sets.id", "attachments.change_set_id")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .select([
        "attachments.id",
        "attachments.original_name",
        "attachments.media_type",
        "attachments.size_bytes",
        "attachments.sha256",
        "attachments.status",
        "attachments.created_at",
        "attachments.repository_path",
        "branch_contexts.full_ref as branch",
        "change_sets.id as change_set_id",
        "change_sets.status as change_set_status",
      ])
      .where("attachments.project_id", "=", projectId)
      .orderBy("attachments.created_at", "desc")
      .execute();
  }

  async recordAttachment(input: {
    branch: string;
    mediaType: string;
    originalName: string;
    projectId: string;
    repositoryPath: string;
    sha256: string;
    sizeBytes: number;
    storageKey: string;
  }) {
    return this.database.transaction().execute(async (transaction) => {
      const branch = await transaction
        .selectFrom("branch_contexts")
        .selectAll()
        .where("project_id", "=", input.projectId)
        .where("full_ref", "=", normalizeBranchRef(input.branch))
        .orderBy("generation", "desc")
        .executeTakeFirst();
      if (!branch) throw new NotFoundError("Branch not found");
      let changeSet = await transaction
        .selectFrom("change_sets")
        .selectAll()
        .where("branch_context_id", "=", branch.id)
        .where("status", "in", ["open", "conflicted"])
        .executeTakeFirst();
      changeSet ??= await transaction
        .insertInto("change_sets")
        .values({
          base_commit_sha: branch.head_commit_sha,
          branch_context_id: branch.id,
          project_id: input.projectId,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      const attachment = await transaction
        .insertInto("attachments")
        .values({
          change_set_id: changeSet.id,
          media_type: input.mediaType,
          original_name: input.originalName,
          project_id: input.projectId,
          repository_path: input.repositoryPath,
          sha256: input.sha256,
          size_bytes: input.sizeBytes,
          status: "ready",
          storage_key: input.storageKey,
        })
        .returning(["id", "original_name", "status"])
        .executeTakeFirstOrThrow();
      await transaction
        .updateTable("change_sets")
        .set({ revision: changeSet.revision + 1, updated_at: new Date() })
        .where("id", "=", changeSet.id)
        .execute();
      await appendEvent(transaction, {
        entityId: attachment.id,
        payload: { branch: input.branch, name: input.originalName },
        projectId: input.projectId,
        revision: 1,
        type: "attachment.ready",
      });
      return attachment;
    });
  }

  async queueChangeSetSubmission(input: {
    changeSetId: string;
    createReview: boolean;
    message: string;
    projectId: string;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const changeSet = await transaction
        .selectFrom("change_sets")
        .select(["id", "revision", "status"])
        .where("id", "=", input.changeSetId)
        .where("project_id", "=", input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!changeSet) throw new NotFoundError("Change set not found");
      if (changeSet.status !== "open") {
        throw new RevisionConflictError("Change set cannot be submitted in its current state");
      }
      await transaction
        .updateTable("change_sets")
        .set({ status: "submitting", updated_at: new Date() })
        .where("id", "=", changeSet.id)
        .execute();
      await transaction
        .insertInto("jobs")
        .values({
          kind: "change-set.submit",
          payload: {
            changeSetId: changeSet.id,
            createReview: input.createReview,
            message: input.message,
            projectId: input.projectId,
          },
        })
        .execute();
      await appendEvent(transaction, {
        entityId: changeSet.id,
        projectId: input.projectId,
        revision: changeSet.revision,
        type: "change-set.submitting",
      });
    });
  }

  async getChangeSetSubmission(changeSetId: string) {
    const target = await this.database
      .selectFrom("change_sets")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .innerJoin("projects", "projects.id", "change_sets.project_id")
      .innerJoin("repositories", "repositories.id", "projects.repository_id")
      .innerJoin("provider_connections", "provider_connections.id", "repositories.connection_id")
      .select([
        "change_sets.id as change_set_id",
        "change_sets.project_id",
        "change_sets.base_commit_sha",
        "change_sets.status",
        "branch_contexts.id as branch_context_id",
        "branch_contexts.full_ref as branch",
        "projects.default_branch",
        "projects.root_path",
        "repositories.provider_repository_id",
        "provider_connections.base_url",
        "provider_connections.kind",
        "provider_connections.secret_encrypted",
      ])
      .where("change_sets.id", "=", changeSetId)
      .executeTakeFirst();
    if (!target) return undefined;
    const files = await this.database
      .selectFrom("draft_files")
      .leftJoin("imported_documents", (join) =>
        join
          .on("imported_documents.branch_context_id", "=", target.branch_context_id)
          .onRef("imported_documents.path", "=", "draft_files.path"),
      )
      .select([
        "draft_files.path",
        "draft_files.operation",
        "draft_files.content as ours_content",
        "imported_documents.content as base_content",
      ])
      .where("draft_files.change_set_id", "=", changeSetId)
      .execute();
    const attachments = await this.database
      .selectFrom("attachments")
      .select(["repository_path", "storage_key"])
      .where("change_set_id", "=", changeSetId)
      .where("status", "=", "ready")
      .execute();
    return { ...target, attachments, files };
  }

  async markChangeSetConflicted(
    changeSetId: string,
    projectId: string,
    upstreamSha: string,
    conflicts: Array<{
      baseContent: string | null;
      oursContent: string | null;
      path: string;
      theirsContent: string | null;
    }>,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const changeSet = await transaction
        .selectFrom("change_sets")
        .select(["branch_context_id", "revision"])
        .where("id", "=", changeSetId)
        .where("project_id", "=", projectId)
        .executeTakeFirstOrThrow();
      await transaction
        .deleteFrom("change_set_conflicts")
        .where("change_set_id", "=", changeSetId)
        .execute();
      if (conflicts.length > 0) {
        await transaction
          .insertInto("change_set_conflicts")
          .values(
            conflicts.map((conflict) => ({
              base_content: conflict.baseContent,
              change_set_id: changeSetId,
              ours_content: conflict.oursContent,
              path: conflict.path,
              theirs_content: conflict.theirsContent,
              theirs_head_sha: upstreamSha,
            })),
          )
          .execute();
      }
      await transaction
        .updateTable("change_sets")
        .set({ status: "conflicted", updated_at: new Date() })
        .where("id", "=", changeSetId)
        .execute();
      await transaction
        .updateTable("branch_contexts")
        .set({ head_commit_sha: upstreamSha, updated_at: new Date() })
        .where("id", "=", changeSet.branch_context_id)
        .execute();
      await appendEvent(transaction, {
        entityId: changeSetId,
        payload: { conflictCount: conflicts.length },
        projectId,
        revision: changeSet.revision,
        type: "change-set.conflicted",
      });
    });
  }

  async listConflicts(projectId: string, branch: string) {
    return this.database
      .selectFrom("change_set_conflicts")
      .innerJoin("change_sets", "change_sets.id", "change_set_conflicts.change_set_id")
      .innerJoin("branch_contexts", "branch_contexts.id", "change_sets.branch_context_id")
      .selectAll("change_set_conflicts")
      .where("change_sets.project_id", "=", projectId)
      .where("branch_contexts.full_ref", "=", normalizeBranchRef(branch))
      .where("change_sets.status", "=", "conflicted")
      .orderBy("change_set_conflicts.path")
      .execute();
  }

  async resolveConflict(input: {
    conflictId: string;
    projectId: string;
    resolution: "ours" | "theirs" | "manual";
    resolvedContent: string;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const conflict = await transaction
        .selectFrom("change_set_conflicts")
        .innerJoin("change_sets", "change_sets.id", "change_set_conflicts.change_set_id")
        .select([
          "change_set_conflicts.id",
          "change_set_conflicts.change_set_id",
          "change_set_conflicts.base_content",
          "change_set_conflicts.ours_content",
          "change_set_conflicts.theirs_content",
          "change_set_conflicts.theirs_head_sha",
          "change_set_conflicts.path",
        ])
        .where("change_set_conflicts.id", "=", input.conflictId)
        .where("change_sets.project_id", "=", input.projectId)
        .forUpdate()
        .executeTakeFirst();
      if (!conflict) throw new NotFoundError("Conflict not found");
      const content =
        input.resolution === "ours"
          ? conflict.ours_content
          : input.resolution === "theirs"
            ? conflict.theirs_content
            : input.resolvedContent;
      await transaction
        .updateTable("draft_files")
        .set({
          content,
          operation:
            content === null ? "delete" : conflict.base_content === null ? "add" : "modify",
          updated_at: new Date(),
        })
        .where("change_set_id", "=", conflict.change_set_id)
        .where("path", "=", conflict.path)
        .execute();
      await transaction
        .updateTable("change_set_conflicts")
        .set({
          resolution: input.resolution,
          resolved_content: content,
          updated_at: new Date(),
        })
        .where("id", "=", conflict.id)
        .execute();
      const unresolved = await transaction
        .selectFrom("change_set_conflicts")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("change_set_id", "=", conflict.change_set_id)
        .where("resolution", "is", null)
        .executeTakeFirstOrThrow();
      if (Number(unresolved.count) === 0) {
        await transaction
          .updateTable("change_sets")
          .set({
            base_commit_sha: conflict.theirs_head_sha,
            status: "open",
            updated_at: new Date(),
          })
          .where("id", "=", conflict.change_set_id)
          .execute();
      }
      await appendEvent(transaction, {
        entityId: conflict.id,
        payload: { path: conflict.path, resolution: input.resolution },
        projectId: input.projectId,
        revision: 1,
        type: "conflict.resolved",
      });
    });
  }

  async markChangeSetSubmitted(input: {
    changeSetId: string;
    commitSha: string;
    commitUrl: string;
    projectId: string;
  }): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const changeSet = await transaction
        .updateTable("change_sets")
        .set({ status: "submitted", updated_at: new Date() })
        .where("id", "=", input.changeSetId)
        .where("project_id", "=", input.projectId)
        .returning(["branch_context_id", "revision"])
        .executeTakeFirstOrThrow();
      const branch = await transaction
        .updateTable("branch_contexts")
        .set({ head_commit_sha: input.commitSha, updated_at: new Date() })
        .where("id", "=", changeSet.branch_context_id)
        .returning("full_ref")
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto("jobs")
        .values({
          kind: "branch.sync",
          payload: { branch: branch.full_ref, projectId: input.projectId },
        })
        .execute();
      await appendEvent(transaction, {
        entityId: input.changeSetId,
        payload: { commitSha: input.commitSha, commitUrl: input.commitUrl },
        projectId: input.projectId,
        revision: changeSet.revision,
        type: "change-set.submitted",
      });
    });
  }

  async releaseChangeSetSubmission(
    changeSetId: string,
    projectId: string,
    error: string,
  ): Promise<void> {
    await this.database.transaction().execute(async (transaction) => {
      const changeSet = await transaction
        .updateTable("change_sets")
        .set({ status: "open", updated_at: new Date() })
        .where("id", "=", changeSetId)
        .where("project_id", "=", projectId)
        .where("status", "=", "submitting")
        .returning("revision")
        .executeTakeFirst();
      if (!changeSet) return;
      await appendEvent(transaction, {
        entityId: changeSetId,
        payload: { error: error.slice(0, 500) },
        projectId,
        revision: changeSet.revision,
        type: "change-set.failed",
      });
    });
  }

  async createInvitation(input: {
    email: string;
    invitedByUserId: string;
    projectId: string;
    role: ProjectRole;
    tokenHash: string;
  }) {
    return this.database
      .insertInto("project_invitations")
      .values({
        email: input.email,
        expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        invited_by_user_id: input.invitedByUserId,
        project_id: input.projectId,
        role: input.role,
        token_hash: input.tokenHash,
      })
      .returning(["id", "expires_at"])
      .executeTakeFirstOrThrow();
  }

  async getInvitation(tokenHash: string) {
    return this.database
      .selectFrom("project_invitations")
      .innerJoin("projects", "projects.id", "project_invitations.project_id")
      .select([
        "project_invitations.id",
        "project_invitations.email",
        "project_invitations.role",
        "project_invitations.project_id",
        "project_invitations.expires_at",
        "projects.name as project_name",
      ])
      .where("project_invitations.token_hash", "=", tokenHash)
      .where("project_invitations.accepted_at", "is", null)
      .where("project_invitations.expires_at", ">", new Date())
      .executeTakeFirst();
  }

  async acceptInvitation(tokenHash: string, userId: string): Promise<{ projectId: string }> {
    return this.database.transaction().execute(async (transaction) => {
      const invitation = await transaction
        .selectFrom("project_invitations")
        .innerJoin("users", "users.email", "project_invitations.email")
        .select([
          "project_invitations.id",
          "project_invitations.project_id",
          "project_invitations.role",
          "users.id as invited_user_id",
        ])
        .where("project_invitations.token_hash", "=", tokenHash)
        .where("project_invitations.accepted_at", "is", null)
        .where("project_invitations.expires_at", ">", new Date())
        .forUpdate()
        .executeTakeFirst();
      if (!invitation || invitation.invited_user_id !== userId) {
        throw new NotFoundError("Invitation is invalid or expired");
      }
      await transaction
        .insertInto("project_memberships")
        .values({
          project_id: invitation.project_id,
          role: invitation.role,
          user_id: userId,
        })
        .onConflict((conflict) =>
          conflict.columns(["project_id", "user_id"]).doUpdateSet({ role: invitation.role }),
        )
        .execute();
      await transaction
        .updateTable("project_invitations")
        .set({ accepted_at: new Date() })
        .where("id", "=", invitation.id)
        .execute();
      await appendEvent(transaction, {
        entityId: userId,
        payload: { role: invitation.role },
        projectId: invitation.project_id,
        revision: 1,
        type: "member.joined",
      });
      return { projectId: invitation.project_id };
    });
  }

  async listMembers(projectId: string) {
    return this.database
      .selectFrom("project_memberships")
      .innerJoin("users", "users.id", "project_memberships.user_id")
      .select([
        "users.id",
        "users.display_name",
        "users.email",
        "users.status",
        "project_memberships.role",
      ])
      .where("project_memberships.project_id", "=", projectId)
      .orderBy("users.display_name")
      .execute();
  }
}

export function createOpaqueToken(): { hash: string; token: string } {
  const token = randomBytes(32).toString("base64url");
  return {
    hash: createHash("sha256").update(token).digest("hex"),
    token,
  };
}

export function hashOpaqueToken(token: string): string {
  const pepper = process.env.PUSHDOCS_SESSION_PEPPER;
  if (!pepper || pepper.length < 32) throw new Error("PUSHDOCS_SESSION_PEPPER is required");
  return createHash("sha256").update(token).update(pepper).digest("hex");
}

export function hashInvitationToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}
