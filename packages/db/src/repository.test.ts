import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkDatabase, closeDatabase, createDatabase, getDatabase } from "./database";
import { appendEvent } from "./events";
import { migrateToLatest } from "./migrations";
import { NotFoundError, PushDocsRepository, RevisionConflictError } from "./repository";
import type { Database } from "./schema";

let database: Kysely<Database>;
let repository: PushDocsRepository;

async function createMemoryDatabase(): Promise<Kysely<Database>> {
  const memory = newDb({ noAstCoverageCheck: true });
  memory.public.registerOperator({
    implementation: (value, pattern) => !new RegExp(pattern).test(value),
    left: DataType.text,
    operator: "!~",
    returns: DataType.bool,
    right: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.text, DataType.text],
    implementation: () => true,
    name: "has_schema_privilege",
    returns: DataType.bool,
  });
  memory.public.registerFunction({
    args: [DataType.integer, DataType.integer],
    implementation: () => null,
    name: "col_description",
    returns: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.text],
    implementation: (value) => value,
    name: "quote_ident",
    returns: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.text, DataType.text],
    implementation: () => null,
    name: "pg_get_serial_sequence",
    returns: DataType.text,
  });
  memory.public.registerFunction({
    args: [DataType.integer],
    implementation: () => 1,
    name: "pg_advisory_xact_lock",
    returns: DataType.integer,
  });
  memory.registerExtension("pgcrypto", (schema) => {
    schema.registerFunction({
      implementation: randomUUID,
      impure: true,
      name: "gen_random_uuid",
      returns: DataType.uuid,
    });
  });
  const adapter = memory.adapters.createPg();
  const result = new Kysely<Database>({
    dialect: new PostgresDialect({ pool: new adapter.Pool() as unknown as Pool }),
  });
  await migrateToLatest(result);
  await sql`alter table change_set_conflicts drop constraint change_set_conflicts_constraint_1`.execute(
    result,
  );
  return result;
}

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  database = await createMemoryDatabase();
  repository = new PushDocsRepository(database);
});

async function projectFixture() {
  const operator = await repository.createOperator({
    displayName: "Admin",
    email: "admin@example.test",
    passwordHash: "hash",
  });
  const connection = await repository.createConnection({
    baseUrl: "https://gitlab.example.test",
    kind: "gitlab",
    name: "GitLab",
    secretEncrypted: "encrypted",
  });
  const project = await repository.createProject({
    connectionId: connection.id,
    defaultBranch: "main",
    name: "Product Docs",
    operatorUserId: operator.id,
    repositoryFullName: "acme/docs",
    repositoryProviderId: "42",
    repositoryUrl: "https://gitlab.example.test/acme/docs.git",
    rootPath: ".",
    slug: "product-docs",
  });
  return { connectionId: connection.id, operatorId: operator.id, projectId: project.id };
}

async function synchronizedProject() {
  const fixture = await projectFixture();
  await repository.replaceImportedDocuments(fixture.projectId, "main", "head-1", [
    {
      content: "# Intro\n",
      contentHash: "hash-1",
      locale: "default",
      path: "docs/intro.md",
      title: "Intro",
      version: "current",
    },
  ]);
  return fixture;
}

afterEach(async () => {
  await database?.destroy();
});

describe("editorial file operations", () => {
  it("refreshes branch protection without advancing the cached working tree", async () => {
    const fixture = await synchronizedProject();
    await repository.ensureBranches(fixture.projectId, [
      { name: "main", sha: "new-head", protected: true },
    ]);
    expect(await repository.listBranches(fixture.projectId)).toEqual([
      expect.objectContaining({ full_ref: "main", head_commit_sha: "head-1", is_protected: true }),
    ]);
    await repository.ensureBranches(fixture.projectId, [
      { name: "main", sha: "new-head", protected: false },
    ]);
    expect(await repository.listBranches(fixture.projectId)).toEqual([
      expect.objectContaining({ is_protected: false }),
    ]);
  });
  it("blocks submission while another participant uploads a file to the same branch", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      projectId: fixture.projectId,
      branch: "main",
      userId: fixture.operatorId,
      path: "docs/intro.md",
      content: "# Edit",
      expectedRevision: 0,
      baseCommitSha: "head-1",
    });
    const state = await repository.listWorkingFiles(fixture.projectId, "main");
    const lease = await repository.beginUpload({
      projectId: fixture.projectId,
      branch: "main",
      expectedRevision: state.changeSet?.revision ?? 0,
      userId: fixture.operatorId,
    });
    const submission = {
      projectId: fixture.projectId,
      changeSetId: draft.changeSetId,
      userId: fixture.operatorId,
      message: "Edit",
      createReview: false,
    };
    await expect(repository.queueChangeSetSubmission(submission)).rejects.toThrow("загрузка");
    await repository.finishUpload(lease.id, fixture.projectId);
    await repository.queueChangeSetSubmission(submission);
    expect((await repository.getChangeSetSubmission(draft.changeSetId))?.status).toBe("submitting");
  });
  it("removes a pending replacement when deleting a media file", async () => {
    const fixture = await synchronizedProject();
    await repository.recordAttachment({
      projectId: fixture.projectId,
      branch: "main",
      repositoryPath: "static/new.png",
      originalName: "new.png",
      mediaType: "image/png",
      sizeBytes: 3,
      sha256: "image",
      storageKey: "fixture/image",
    });
    const state = await repository.listWorkingFiles(fixture.projectId, "main");
    await repository.stageFiles({
      projectId: fixture.projectId,
      branch: "main",
      userId: fixture.operatorId,
      expectedRevision: state.changeSet?.revision ?? 0,
      files: [{ path: "static/new.png", content: null }],
    });
    expect(await repository.listAttachments(fixture.projectId)).toHaveLength(0);
  });
  it("records a prepared commit once so a retry cannot silently choose a different result", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      projectId: fixture.projectId,
      userId: fixture.operatorId,
      branch: "main",
      path: "docs/intro.md",
      content: "# Edit",
      expectedRevision: 0,
      baseCommitSha: "head-1",
    });
    const prepared = {
      branch: "main",
      parentSha: "a".repeat(40),
      sha: "b".repeat(40),
      operationId: "attempt-1",
      createdAt: "2026-09-08T00:00:00Z",
    };
    await expect(repository.savePreparedCommit(draft.changeSetId, prepared)).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
    await expect(
      repository.withGitRefLock("fixture:ref", async () => "locked result"),
    ).resolves.toBe("locked result");
    await repository.queueChangeSetSubmission({
      changeSetId: draft.changeSetId,
      projectId: fixture.projectId,
      userId: fixture.operatorId,
      createReview: false,
      message: "Edit",
    });
    await repository.savePreparedCommit(draft.changeSetId, prepared);
    await repository.savePreparedCommit(draft.changeSetId, prepared);
    expect((await repository.getChangeSetSubmission(draft.changeSetId))?.prepared_commit).toEqual(
      prepared,
    );
    await expect(
      repository.savePreparedCommit(draft.changeSetId, { ...prepared, sha: "c".repeat(40) }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await repository.releaseChangeSetSubmission(
      draft.changeSetId,
      fixture.projectId,
      "Network outcome unknown",
    );
    expect((await repository.getChangeSetSubmission(draft.changeSetId))?.status).toBe("submitting");
    await expect(
      repository.retryChangeSetSubmission(draft.changeSetId, fixture.projectId, fixture.operatorId),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    const job = await database
      .selectFrom("jobs")
      .selectAll()
      .where("kind", "=", "change-set.submit")
      .executeTakeFirstOrThrow();
    await repository.failJob(job.id, "Connection lost", false);
    expect(await repository.getSubmissionStatus(fixture.projectId, "main")).toMatchObject({
      status: "failed",
      last_error: "Connection lost",
    });
    await repository.retryChangeSetSubmission(
      draft.changeSetId,
      fixture.projectId,
      fixture.operatorId,
    );
    const retried = await database
      .selectFrom("jobs")
      .selectAll()
      .where("id", "=", job.id)
      .executeTakeFirstOrThrow();
    expect(retried).toMatchObject({ status: "queued", attempts: 0, payload: job.payload });
    await repository.discardRejectedCommit(draft.changeSetId, fixture.projectId);
    await repository.releaseChangeSetSubmission(
      draft.changeSetId,
      fixture.projectId,
      "Lease rejected",
    );
    await expect(
      repository.retryChangeSetSubmission(draft.changeSetId, fixture.projectId, fixture.operatorId),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
  it("limits concurrent uploads per project and rejects outdated upload revisions", async () => {
    const fixture = await synchronizedProject();
    const input = {
      projectId: fixture.projectId,
      branch: "main",
      expectedRevision: 0,
      userId: fixture.operatorId,
    };
    await expect(repository.beginUpload({ ...input, expectedRevision: 1 })).rejects.toBeInstanceOf(
      RevisionConflictError,
    );
    for (let index = 0; index < 4; index++) await repository.beginUpload(input);
    await expect(repository.beginUpload(input)).rejects.toThrow("четыре загрузки");
  });
  it("moves an existing article atomically and allows reverting the move", async () => {
    const { projectId, operatorId } = await synchronizedProject();
    await repository.stageFiles({
      projectId,
      userId: operatorId,
      branch: "main",
      expectedRevision: 0,
      files: [
        { path: "docs/intro.md", content: null },
        { path: "docs/guide.md", content: "# Intro\n" },
      ],
    });
    const files = await repository.listDraftFiles(projectId, "main");
    expect(files.map((file) => [file.path, file.operation]).sort()).toEqual([
      ["docs/guide.md", "add"],
      ["docs/intro.md", "delete"],
    ]);
    await repository.stageFiles({
      projectId,
      userId: operatorId,
      branch: "main",
      expectedRevision: 1,
      files: [
        { path: "docs/intro.md", revert: true },
        { path: "docs/guide.md", revert: true },
      ],
    });
    expect(await repository.listDraftFiles(projectId, "main")).toEqual([]);
  });

  it("rejects a stale file operation without overwriting another editor", async () => {
    const { projectId, operatorId } = await synchronizedProject();
    const input = {
      projectId,
      userId: operatorId,
      branch: "main",
      expectedRevision: 0,
      files: [{ path: "docs/intro.md", content: "# Changed" }],
    };
    await repository.stageFiles(input);
    await expect(
      repository.stageFiles({ ...input, files: [{ path: "docs/intro.md", content: null }] }),
    ).rejects.toThrow(RevisionConflictError);
    expect((await repository.getDocument(projectId, "main", "docs/intro.md"))?.draft_content).toBe(
      "# Changed",
    );
  });

  it("rejects unsafe paths before recording a change", async () => {
    const { projectId, operatorId } = await synchronizedProject();
    await expect(
      repository.stageFiles({
        projectId,
        userId: operatorId,
        branch: "main",
        expectedRevision: 0,
        files: [{ path: "../secret", content: "bad" }],
      }),
    ).rejects.toThrow();
    expect(await repository.listDraftFiles(projectId, "main")).toEqual([]);
  });
});

describe("database connection", () => {
  it("requires a connection string", () => {
    const previous = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    expect(() => createDatabase()).toThrow("DATABASE_URL is required");
    if (previous !== undefined) process.env.DATABASE_URL = previous;
  });

  it("passes the readiness query on a working database", async () => {
    await expect(checkDatabase(database)).resolves.toBeUndefined();
  });

  it("creates and closes the shared database lazily", async () => {
    await closeDatabase();
    const previous = process.env.DATABASE_URL;
    process.env.DATABASE_URL = "postgresql://pushdocs:pushdocs@127.0.0.1:1/pushdocs";
    const first = getDatabase();
    expect(getDatabase()).toBe(first);
    await closeDatabase();
    const second = getDatabase();
    expect(second).not.toBe(first);
    await closeDatabase();
    if (previous === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previous;
  });
});

describe("domain events", () => {
  it("assigns increasing sequences and default payloads", async () => {
    const user = await repository.createUser({
      displayName: "Recipient",
      email: "recipient@example.test",
      passwordHash: "hash",
    });
    await expect(
      appendEvent(database, {
        entityId: "one",
        recipientUserId: user.id,
        revision: 1,
        type: "test.one",
      }),
    ).resolves.toBe(1);
    await expect(
      appendEvent(database, {
        entityId: "two",
        payload: { value: 2 },
        recipientUserId: user.id,
        revision: 2,
        type: "test.two",
      }),
    ).resolves.toBe(2);
    await expect(
      database
        .selectFrom("domain_events")
        .select(["sequence", "payload"])
        .orderBy("sequence")
        .execute(),
    ).resolves.toEqual([
      { payload: {}, sequence: 1 },
      { payload: { value: 2 }, sequence: 2 },
    ]);
  });
});

describe("installation bootstrap", () => {
  it("allows one operator to bootstrap the installation", async () => {
    await expect(repository.isBootstrapped()).resolves.toBe(false);
    const operator = await repository.createOperator({
      displayName: "Admin",
      email: "admin@example.test",
      passwordHash: "hash",
    });
    expect(operator.id).toMatch(/^[0-9a-f-]{36}$/);
    await expect(repository.isBootstrapped()).resolves.toBe(true);
    await expect(
      repository.createOperator({
        displayName: "Other",
        email: "other@example.test",
        passwordHash: "hash",
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
  });
});

describe("users and sessions", () => {
  it("creates active users and finds them by email", async () => {
    const user = await repository.createUser({
      displayName: "Reader",
      email: "reader@example.test",
      passwordHash: "password-hash",
    });
    await expect(repository.findUserByEmail("reader@example.test")).resolves.toMatchObject({
      display_name: "Reader",
      id: user.id,
      status: "active",
    });
    await expect(repository.findUserByEmail("missing@example.test")).resolves.toBeUndefined();
  });

  it("creates, resolves, expires, and deletes sessions", async () => {
    const user = await repository.createUser({
      displayName: "Editor",
      email: "editor@example.test",
      passwordHash: "hash",
    });
    await repository.createSession(user.id, "valid", new Date(Date.now() + 60_000));
    await repository.createSession(user.id, "expired", new Date(Date.now() - 60_000));
    await expect(repository.findUserBySessionHash("valid")).resolves.toMatchObject({
      display_name: "Editor",
      id: user.id,
    });
    await expect(repository.findUserBySessionHash("expired")).resolves.toBeUndefined();
    await repository.deleteSession("valid");
    await expect(repository.findUserBySessionHash("valid")).resolves.toBeUndefined();
  });

  it("does not return blocked users", async () => {
    const user = await repository.createUser({
      displayName: "Blocked",
      email: "blocked@example.test",
      passwordHash: "hash",
    });
    await database
      .updateTable("users")
      .set({ status: "blocked" })
      .where("id", "=", user.id)
      .execute();
    await expect(repository.findUserByEmail("blocked@example.test")).resolves.toBeUndefined();
  });
});

describe("connections and projects", () => {
  it("creates and lists provider connections", async () => {
    const connection = await repository.createConnection({
      baseUrl: "https://github.com",
      kind: "github",
      name: "GitHub",
      secretEncrypted: "secret",
    });
    await expect(repository.getConnection(connection.id)).resolves.toMatchObject({
      base_url: "https://github.com",
      kind: "github",
      secret_encrypted: "secret",
    });
    await expect(repository.listConnections()).resolves.toEqual([
      expect.objectContaining({ id: connection.id, name: "GitHub" }),
    ]);
    await expect(repository.getConnection(randomUUID())).resolves.toBeUndefined();
  });

  it("creates a project with its administrator, grant, sync job, and event", async () => {
    const fixture = await projectFixture();
    await expect(
      repository.requireProjectAccess(fixture.operatorId, fixture.projectId),
    ).resolves.toEqual({
      projectId: fixture.projectId,
      role: "admin",
    });
    await expect(repository.getProjectSyncTarget(fixture.projectId)).resolves.toMatchObject({
      default_branch: "main",
      kind: "gitlab",
      provider_repository_id: "42",
      root_path: ".",
    });
    await expect(repository.listActiveProjectIds()).resolves.toEqual([fixture.projectId]);

    const jobs = await database.selectFrom("jobs").select(["kind", "payload"]).execute();
    expect(jobs).toEqual([{ kind: "project.sync", payload: { projectId: fixture.projectId } }]);
    const events = await database
      .selectFrom("domain_events")
      .select(["type", "project_id"])
      .execute();
    expect(events).toContainEqual({ project_id: fixture.projectId, type: "project.created" });
  });

  it("lists project summaries with review counts and attention status", async () => {
    const fixture = await projectFixture();
    await repository.replaceChangeRequests(fixture.projectId, [
      {
        checks: [],
        externalId: "7",
        headSha: "head",
        sourceBranch: "docs/update",
        state: "open",
        targetBranch: "main",
        title: "Update",
        url: "https://gitlab.test/mr/7",
      },
    ]);
    await expect(repository.listProjects(fixture.operatorId)).resolves.toEqual([
      expect.objectContaining({
        id: fixture.projectId,
        openChangeRequests: 1,
        provider: "gitlab",
        providerLabel: "GitLab",
        role: "admin",
        syncStatus: "current",
      }),
    ]);
    await repository.markProjectAttention(fixture.projectId);
    await expect(repository.listProjects(fixture.operatorId)).resolves.toEqual([
      expect.objectContaining({ syncStatus: "attention" }),
    ]);
  });

  it("enforces membership permissions without disclosing missing projects", async () => {
    const fixture = await projectFixture();
    const reader = await repository.createUser({
      displayName: "Reader",
      email: "reader@example.test",
      passwordHash: "hash",
    });
    await database
      .insertInto("project_memberships")
      .values({ project_id: fixture.projectId, role: "reader", user_id: reader.id })
      .execute();
    await expect(
      repository.requireProjectAccess(reader.id, fixture.projectId, "comment:create"),
    ).resolves.toMatchObject({ role: "reader" });
    await expect(
      repository.requireProjectAccess(reader.id, fixture.projectId, "document:write"),
    ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
    await expect(repository.requireProjectAccess(reader.id, randomUUID())).rejects.toBeInstanceOf(
      NotFoundError,
    );
  });
});

describe("branches and imported documents", () => {
  it("replaces a branch snapshot and updates an existing branch", async () => {
    const fixture = await synchronizedProject();
    await expect(repository.listBranches(fixture.projectId)).resolves.toEqual([
      expect.objectContaining({ full_ref: "main", head_commit_sha: "head-1" }),
    ]);
    await expect(repository.listDocuments(fixture.projectId, "main")).resolves.toEqual([
      {
        locale: "default",
        path: "docs/intro.md",
        status: "clean",
        title: "Intro",
        version: "current",
      },
    ]);
    await expect(
      repository.getDocument(fixture.projectId, "main", "docs/intro.md"),
    ).resolves.toMatchObject({
      head_commit_sha: "head-1",
      source_content: "# Intro\n",
      title: "Intro",
    });

    await repository.replaceImportedDocuments(fixture.projectId, "main", "head-2", [
      {
        content: "# Updated\n",
        contentHash: "hash-2",
        locale: "ru",
        path: "docs/updated.md",
        title: "Updated",
        version: "2",
      },
    ]);
    await expect(repository.listDocuments(fixture.projectId, "main")).resolves.toEqual([
      expect.objectContaining({ path: "docs/updated.md", title: "Updated" }),
    ]);
    await expect(
      repository.getDocument(fixture.projectId, "main", "docs/intro.md"),
    ).resolves.toBeUndefined();
  });

  it("ensures branches idempotently and queues branch synchronization", async () => {
    const fixture = await projectFixture();
    const first = await repository.ensureBranch(fixture.projectId, "docs/update", "one");
    const second = await repository.ensureBranch(fixture.projectId, "docs/update", "two");
    expect(second.id).toBe(first.id);
    expect(second.head_commit_sha).toBe("one");
    await repository.ensureBranches(fixture.projectId, []);
    await repository.ensureBranches(fixture.projectId, [
      { name: "main", sha: "main-sha" },
      { name: "release", sha: "release-sha" },
    ]);
    await repository.ensureBranches(fixture.projectId, [{ name: "main", sha: "ignored" }]);
    await expect(repository.listBranches(fixture.projectId)).resolves.toHaveLength(3);
    await repository.enqueueBranchSync(fixture.projectId, "release");
    const queued = await database
      .selectFrom("jobs")
      .select(["kind", "payload"])
      .where("kind", "=", "branch.sync")
      .executeTakeFirstOrThrow();
    expect(queued.payload).toEqual({ branch: "release", projectId: fixture.projectId });
  });

  it("detects components and lets administrators replace their definitions", async () => {
    const fixture = await projectFixture();
    await repository.ensureProjectComponents(fixture.projectId, []);
    await repository.ensureProjectComponents(fixture.projectId, ["Callout", "Tabs.Group"]);
    await repository.ensureProjectComponents(fixture.projectId, ["Callout"]);
    await expect(repository.listProjectComponents(fixture.projectId)).resolves.toEqual([
      expect.objectContaining({ label: "Callout", name: "Callout", source: "detected" }),
      expect.objectContaining({ name: "Tabs.Group" }),
    ]);
    const component = await repository.createProjectComponent({
      description: "A warning box",
      label: "Warning",
      name: "Callout",
      projectId: fixture.projectId,
      snippet: '<Callout tone="warning" />',
    });
    expect(component.id).toBeTruthy();
    await expect(repository.listProjectComponents(fixture.projectId)).resolves.toContainEqual(
      expect.objectContaining({ label: "Warning", source: "manual" }),
    );
  });
});

describe("drafts and comments", () => {
  it("creates a new document and derives its title", async () => {
    const fixture = await synchronizedProject();
    await repository.createDraftDocument({
      branch: "main",
      content: "# New page\n",
      path: "docs/new-page.mdx",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await expect(repository.listDocuments(fixture.projectId, "main")).resolves.toContainEqual({
      locale: "default",
      path: "docs/new-page.mdx",
      status: "added",
      title: "New page",
      version: "current",
    });
    await expect(
      repository.getDocument(fixture.projectId, "main", "docs/new-page.mdx"),
    ).resolves.toMatchObject({
      draft_content: "# New page\n",
      source_content: "",
      title: "New page",
    });
  });

  it("uses a filename title and rejects missing branches or existing documents", async () => {
    const fixture = await synchronizedProject();
    await expect(
      repository.createDraftDocument({
        branch: "missing",
        content: "text",
        path: "docs/new.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
    await expect(
      repository.createDraftDocument({
        branch: "main",
        content: "text",
        path: "docs/intro.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await repository.createDraftDocument({
      branch: "main",
      content: "No heading",
      path: "docs/file_name.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await expect(
      repository.getDocument(fixture.projectId, "main", "docs/file_name.md"),
    ).resolves.toMatchObject({
      title: "file name",
    });
  });

  it("saves drafts with optimistic revisions", async () => {
    const fixture = await synchronizedProject();
    const first = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# First draft",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    expect(first.revision).toBe(1);
    const second = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Second draft",
      expectedRevision: 1,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    expect(second).toEqual({ changeSetId: first.changeSetId, revision: 2 });
    await expect(
      repository.saveDraft({
        baseCommitSha: "head-1",
        branch: "main",
        content: "# Stale draft",
        expectedRevision: 1,
        path: "docs/intro.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(repository.listDocuments(fixture.projectId, "main")).resolves.toContainEqual(
      expect.objectContaining({ path: "docs/intro.md", status: "modified" }),
    );
    await expect(repository.listDraftFiles(fixture.projectId, "main")).resolves.toContainEqual(
      expect.objectContaining({ path: "docs/intro.md", revision: 2 }),
    );
  });

  it("rejects saving a draft on a missing branch", async () => {
    const fixture = await projectFixture();
    await expect(
      repository.saveDraft({
        baseCommitSha: "head",
        branch: "missing",
        content: "text",
        expectedRevision: 0,
        path: "docs/a.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("creates anchored and document comments", async () => {
    const fixture = await synchronizedProject();
    const created = await repository.createComment({
      anchorQuote: "Intro",
      body: "Please expand this section",
      branch: "main",
      documentPath: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    expect(created.discussionId).toBeTruthy();
    await expect(
      repository.listComments(fixture.projectId, "main", "docs/intro.md"),
    ).resolves.toEqual([
      expect.objectContaining({
        anchor_quote: "Intro",
        author_name: "Admin",
        body: "Please expand this section",
        discussion_id: created.discussionId,
      }),
    ]);
    await expect(
      repository.createComment({
        anchorQuote: null,
        body: "Missing",
        branch: "missing",
        documentPath: "docs/intro.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("reviews and checks", () => {
  it("replaces provider reviews and their checks", async () => {
    const fixture = await projectFixture();
    await repository.replaceChangeRequests(fixture.projectId, [
      {
        checks: [
          {
            conclusion: "success",
            durationMs: 1200,
            id: "check-1",
            name: "test",
            required: true,
            url: "https://ci.test/1",
          },
        ],
        externalId: "1",
        headSha: "head-1",
        sourceBranch: "docs/update",
        state: "open",
        targetBranch: "main",
        title: "Update",
        url: "https://git.test/review/1",
      },
    ]);
    const review = (await repository.listChangeRequests(fixture.projectId))[0];
    expect(review).toMatchObject({ external_id: "1", state: "open", title: "Update" });
    await expect(repository.listChecks(review?.id ?? "")).resolves.toEqual([
      expect.objectContaining({ conclusion: "success", external_id: "check-1", required: true }),
    ]);

    await repository.replaceChangeRequests(fixture.projectId, []);
    await expect(repository.listChangeRequests(fixture.projectId)).resolves.toEqual([
      expect.objectContaining({ external_id: "1", state: "closed" }),
    ]);
  });

  it("updates an existing review and removes old checks", async () => {
    const fixture = await projectFixture();
    const initial = {
      checks: [
        {
          conclusion: "running" as const,
          durationMs: null,
          id: "old",
          name: "old",
          required: true,
          url: null,
        },
      ],
      externalId: "2",
      headSha: "head-1",
      sourceBranch: "docs",
      state: "open" as const,
      targetBranch: "main",
      title: "Old title",
      url: "old-url",
    };
    await repository.replaceChangeRequests(fixture.projectId, [initial]);
    await repository.replaceChangeRequests(fixture.projectId, [
      { ...initial, checks: [], headSha: "head-2", state: "merged", title: "New title" },
    ]);
    const review = (await repository.listChangeRequests(fixture.projectId))[0];
    expect(review).toMatchObject({ head_sha: "head-2", state: "merged", title: "New title" });
    await expect(repository.listChecks(review?.id ?? "")).resolves.toEqual([]);
  });
});

describe("attachments and submissions", () => {
  it("records ready attachments in the branch change set", async () => {
    const fixture = await synchronizedProject();
    const attachment = await repository.recordAttachment({
      branch: "main",
      mediaType: "image/png",
      originalName: "diagram.png",
      projectId: fixture.projectId,
      repositoryPath: "static/img/diagram.png",
      sha256: "sha256",
      sizeBytes: 42,
      storageKey: `${fixture.projectId}/diagram.png`,
    });
    expect(attachment).toMatchObject({ original_name: "diagram.png", status: "ready" });
    await expect(repository.listAttachments(fixture.projectId)).resolves.toEqual([
      expect.objectContaining({
        branch: "main",
        repository_path: "static/img/diagram.png",
        size_bytes: 42,
      }),
    ]);
    await expect(
      repository.recordAttachment({
        branch: "missing",
        mediaType: "image/png",
        originalName: "bad.png",
        projectId: fixture.projectId,
        repositoryPath: "static/img/bad.png",
        sha256: "bad",
        sizeBytes: 1,
        storageKey: `${fixture.projectId}/bad.png`,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("queues an open change set and exposes the complete submission", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Changed",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.recordAttachment({
      branch: "main",
      mediaType: "image/png",
      originalName: "a.png",
      projectId: fixture.projectId,
      repositoryPath: "static/img/a.png",
      sha256: "image-hash",
      sizeBytes: 10,
      storageKey: "stored/a.png",
    });
    await repository.queueChangeSetSubmission({
      changeSetId: draft.changeSetId,
      createReview: true,
      message: "Update docs",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      attachments: [{ repository_path: "static/img/a.png", storage_key: "stored/a.png" }],
      branch: "main",
      files: [expect.objectContaining({ ours_content: "# Changed", path: "docs/intro.md" })],
      status: "submitting",
    });
    await expect(
      repository.queueChangeSetSubmission({
        changeSetId: draft.changeSetId,
        createReview: false,
        message: "Again",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(RevisionConflictError);
    await expect(repository.getChangeSetSubmission(randomUUID())).resolves.toBeUndefined();
  });

  it("rejects a missing change set submission", async () => {
    const fixture = await projectFixture();
    await expect(
      repository.queueChangeSetSubmission({
        changeSetId: randomUUID(),
        createReview: false,
        message: "Missing",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it("marks a submission complete and queues a fresh branch import", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Changed",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.markChangeSetSubmitted({
      changeSetId: draft.changeSetId,
      commitSha: "head-2",
      commitUrl: "https://git.test/commit/head-2",
      projectId: fixture.projectId,
    });
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      status: "submitted",
    });
    await expect(repository.listBranches(fixture.projectId)).resolves.toContainEqual(
      expect.objectContaining({ head_commit_sha: "head-2" }),
    );
    const job = await database
      .selectFrom("jobs")
      .select(["kind", "payload"])
      .where("kind", "=", "branch.sync")
      .executeTakeFirstOrThrow();
    expect(job.payload).toEqual({ branch: "main", projectId: fixture.projectId });
  });

  it("releases a failed submission once and records a bounded error", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Changed",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.queueChangeSetSubmission({
      changeSetId: draft.changeSetId,
      createReview: false,
      message: "Update",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.releaseChangeSetSubmission(
      draft.changeSetId,
      fixture.projectId,
      "x".repeat(800),
    );
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      status: "open",
    });
    await repository.releaseChangeSetSubmission(draft.changeSetId, fixture.projectId, "ignored");
    const failedEvents = await database
      .selectFrom("domain_events")
      .select(["payload"])
      .where("type", "=", "change-set.failed")
      .execute();
    expect(failedEvents).toHaveLength(1);
    const payload = failedEvents[0]?.payload as { error: string } | undefined;
    expect(payload?.error).toHaveLength(500);
  });
});

describe("conflict resolution", () => {
  it.each(["ours", "theirs"] as const)(
    "resolves binary conflicts with %s without converting bytes into text",
    async (resolution) => {
      const fixture = await synchronizedProject();
      await repository.recordAttachment({
        projectId: fixture.projectId,
        branch: "main",
        repositoryPath: "static/image.png",
        originalName: "image.png",
        mediaType: "image/png",
        sizeBytes: 3,
        sha256: "ours",
        storageKey: "fixture/image",
      });
      const attachment = (await repository.listAttachments(fixture.projectId))[0]!;
      await repository.markChangeSetConflicted(
        attachment.change_set_id,
        fixture.projectId,
        "head-2",
        [
          {
            kind: "binary",
            path: "static/image.png",
            baseContent: "base-hash",
            oursContent: "ours-hash",
            theirsContent: "theirs-hash",
          },
        ],
      );
      const conflict = (await repository.listConflicts(fixture.projectId, "main"))[0]!;
      await expect(
        repository.resolveConflict({
          conflictId: conflict.id,
          projectId: fixture.projectId,
          resolution: "manual",
          resolvedContent: "not bytes",
        }),
      ).rejects.toThrow();
      await repository.resolveConflict({
        conflictId: conflict.id,
        projectId: fixture.projectId,
        resolution,
        resolvedContent: "",
      });
      expect(await repository.listAttachments(fixture.projectId)).toHaveLength(
        resolution === "ours" ? 1 : 0,
      );
      const submission = await repository.getChangeSetSubmission(attachment.change_set_id);
      expect(submission).toMatchObject({ status: "open", base_commit_sha: "head-2", files: [] });
      await expect(
        repository.resolveConflict({
          conflictId: conflict.id,
          projectId: fixture.projectId,
          resolution,
          resolvedContent: "",
        }),
      ).rejects.toThrow();
    },
  );
  it("records a conflicted change set even when no file conflict remains", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Ours",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.markChangeSetConflicted(draft.changeSetId, fixture.projectId, "head-2", []);
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      status: "conflicted",
    });
  });

  it.each([
    ["ours", "# Ours", "modify"],
    ["theirs", "# Theirs", "modify"],
    ["manual", "# Combined", "modify"],
  ] as const)(
    "resolves a conflict with %s content",
    async (resolution, expectedContent, operation) => {
      const fixture = await synchronizedProject();
      const draft = await repository.saveDraft({
        baseCommitSha: "head-1",
        branch: "main",
        content: "# Ours",
        expectedRevision: 0,
        path: "docs/intro.md",
        projectId: fixture.projectId,
        userId: fixture.operatorId,
      });
      await repository.markChangeSetConflicted(draft.changeSetId, fixture.projectId, "head-2", [
        {
          baseContent: "# Intro\n",
          oursContent: "# Ours",
          path: "docs/intro.md",
          theirsContent: "# Theirs",
        },
      ]);
      const conflict = (await repository.listConflicts(fixture.projectId, "main"))[0];
      expect(conflict).toMatchObject({ ours_content: "# Ours", theirs_head_sha: "head-2" });
      await repository.resolveConflict({
        conflictId: conflict?.id ?? "",
        projectId: fixture.projectId,
        resolution,
        resolvedContent: "# Combined",
      });
      await expect(repository.listConflicts(fixture.projectId, "main")).resolves.toEqual([]);
      await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
        base_commit_sha: "head-2",
        files: [expect.objectContaining({ operation, ours_content: expectedContent })],
        status: "open",
      });
    },
  );

  it("turns a removed upstream file into an added draft and supports deletion", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Ours",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await repository.markChangeSetConflicted(draft.changeSetId, fixture.projectId, "head-2", [
      { baseContent: null, oursContent: "# Ours", path: "docs/intro.md", theirsContent: null },
    ]);
    let conflict = (await repository.listConflicts(fixture.projectId, "main"))[0];
    await repository.resolveConflict({
      conflictId: conflict?.id ?? "",
      projectId: fixture.projectId,
      resolution: "ours",
      resolvedContent: "",
    });
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      files: [expect.objectContaining({ operation: "add" })],
    });

    await repository.markChangeSetConflicted(draft.changeSetId, fixture.projectId, "head-3", [
      { baseContent: "# Base", oursContent: "# Ours", path: "docs/intro.md", theirsContent: null },
    ]);
    conflict = (await repository.listConflicts(fixture.projectId, "main"))[0];
    await repository.resolveConflict({
      conflictId: conflict?.id ?? "",
      projectId: fixture.projectId,
      resolution: "theirs",
      resolvedContent: "",
    });
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      files: [expect.objectContaining({ operation: "delete", ours_content: null })],
    });
  });

  it("keeps the change set conflicted until every file is resolved", async () => {
    const fixture = await synchronizedProject();
    const draft = await repository.saveDraft({
      baseCommitSha: "head-1",
      branch: "main",
      content: "# Ours",
      expectedRevision: 0,
      path: "docs/intro.md",
      projectId: fixture.projectId,
      userId: fixture.operatorId,
    });
    await database
      .insertInto("draft_files")
      .values({
        author_user_id: fixture.operatorId,
        change_set_id: draft.changeSetId,
        content: "# Other",
        operation: "modify",
        path: "docs/other.md",
      })
      .execute();
    await repository.markChangeSetConflicted(draft.changeSetId, fixture.projectId, "head-2", [
      { baseContent: "A", oursContent: "B", path: "docs/intro.md", theirsContent: "C" },
      { baseContent: "A", oursContent: "B", path: "docs/other.md", theirsContent: "C" },
    ]);
    const conflicts = await repository.listConflicts(fixture.projectId, "main");
    await repository.resolveConflict({
      conflictId: conflicts[0]?.id ?? "",
      projectId: fixture.projectId,
      resolution: "manual",
      resolvedContent: "D",
    });
    await expect(repository.listConflicts(fixture.projectId, "main")).resolves.toHaveLength(2);
    await expect(repository.getChangeSetSubmission(draft.changeSetId)).resolves.toMatchObject({
      status: "conflicted",
    });
  });

  it("rejects an unknown conflict", async () => {
    const fixture = await projectFixture();
    await expect(
      repository.resolveConflict({
        conflictId: randomUUID(),
        projectId: fixture.projectId,
        resolution: "manual",
        resolvedContent: "text",
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe("invitations and members", () => {
  it("accepts an invitation only for its matching user", async () => {
    const fixture = await projectFixture();
    const reader = await repository.createUser({
      displayName: "Reader",
      email: "reader@example.test",
      passwordHash: "hash",
    });
    const other = await repository.createUser({
      displayName: "Other",
      email: "other@example.test",
      passwordHash: "hash",
    });
    const created = await repository.createInvitation({
      email: "reader@example.test",
      invitedByUserId: fixture.operatorId,
      projectId: fixture.projectId,
      role: "reader",
      tokenHash: "invitation-hash",
    });
    expect(created.expires_at.getTime()).toBeGreaterThan(Date.now());
    await expect(repository.getInvitation("invitation-hash")).resolves.toMatchObject({
      email: "reader@example.test",
      project_name: "Product Docs",
      role: "reader",
    });
    await expect(repository.acceptInvitation("invitation-hash", other.id)).rejects.toBeInstanceOf(
      NotFoundError,
    );
    await expect(repository.acceptInvitation("invitation-hash", reader.id)).resolves.toEqual({
      projectId: fixture.projectId,
    });
    await expect(repository.getInvitation("invitation-hash")).resolves.toBeUndefined();
    await expect(repository.listMembers(fixture.projectId)).resolves.toEqual([
      expect.objectContaining({ display_name: "Admin", role: "admin" }),
      expect.objectContaining({ display_name: "Reader", role: "reader" }),
    ]);
  });

  it("updates an existing membership when a new invitation is accepted", async () => {
    const fixture = await projectFixture();
    const member = await repository.createUser({
      displayName: "Member",
      email: "member@example.test",
      passwordHash: "hash",
    });
    await database
      .insertInto("project_memberships")
      .values({ project_id: fixture.projectId, role: "reader", user_id: member.id })
      .execute();
    await repository.createInvitation({
      email: "member@example.test",
      invitedByUserId: fixture.operatorId,
      projectId: fixture.projectId,
      role: "editor",
      tokenHash: "upgrade",
    });
    await repository.acceptInvitation("upgrade", member.id);
    await expect(
      repository.requireProjectAccess(member.id, fixture.projectId),
    ).resolves.toMatchObject({
      role: "editor",
    });
  });
});

describe("job lifecycle", () => {
  it("recovers an expired lease and ignores acknowledgements from its old worker", async () => {
    await projectFixture();
    const first = (await repository.claimNextJob())!;
    await database
      .updateTable("jobs")
      .set({ locked_at: new Date(0) })
      .where("id", "=", first.id)
      .execute();
    const recovered = (await repository.claimNextJob())!;
    expect(recovered).toMatchObject({ id: first.id, attempts: 2 });
    await repository.completeJob(first.id, first.attempts);
    await repository.failJob(first.id, "stale", false, first.attempts);
    expect(await repository.heartbeatJob(first.id, first.attempts)).toBe(false);
    expect(await repository.heartbeatJob(recovered.id, recovered.attempts)).toBe(true);
    expect(
      (
        await database
          .selectFrom("jobs")
          .selectAll()
          .where("id", "=", first.id)
          .executeTakeFirstOrThrow()
      ).status,
    ).toBe("running");
    await repository.completeJob(recovered.id, recovered.attempts);
    await expect(repository.claimNextJob()).resolves.toBeUndefined();
  });
  it("claims, completes, retries, and permanently fails jobs", async () => {
    const fixture = await projectFixture();
    const first = await repository.claimNextJob();
    expect(first).toMatchObject({ attempts: 1, kind: "project.sync", status: "running" });
    await repository.completeJob(first?.id ?? "");
    await expect(repository.claimNextJob()).resolves.toBeUndefined();

    await repository.enqueueBranchSync(fixture.projectId, "main");
    const retry = await repository.claimNextJob();
    await repository.failJob(retry?.id ?? "", "temporary", true);
    await expect(repository.claimNextJob()).resolves.toBeUndefined();
    await database
      .updateTable("jobs")
      .set({ available_at: new Date(Date.now() - 1000) })
      .where("id", "=", retry?.id ?? "")
      .execute();
    const secondAttempt = await repository.claimNextJob();
    expect(secondAttempt?.attempts).toBe(2);
    await repository.failJob(secondAttempt?.id ?? "", "x".repeat(5000), false);
    const failed = await database
      .selectFrom("jobs")
      .select(["last_error", "status"])
      .where("id", "=", secondAttempt?.id ?? "")
      .executeTakeFirstOrThrow();
    expect(failed.status).toBe("failed");
    expect(failed.last_error).toHaveLength(4000);
  });
});

describe("working tree projection", () => {
  it("includes repository paths, draft additions, modifications and deletions", async () => {
    const fixture = await synchronizedProject();
    await repository.replaceImportedDocuments(
      fixture.projectId,
      "main",
      "head-1",
      [
        {
          path: "docs/intro.md",
          content: "# Intro\n",
          contentHash: "hash",
          title: "Intro",
          locale: "default",
          version: "current",
        },
      ],
      ["docs/intro.md", "static/img/a.png"],
    );
    const input = {
      projectId: fixture.projectId,
      userId: fixture.operatorId,
      branch: "main",
      expectedRevision: 0,
    };
    expect(
      (await repository.listWorkingFiles(fixture.projectId, "main")).branch.repository_paths,
    ).toContain("static/img/a.png");
    await repository.stageFiles({
      ...input,
      files: [
        { path: "docs/intro.md", content: "# Changed" },
        { path: "docs/new.md", content: "# New" },
      ],
    });
    let tree = await repository.listWorkingFiles(fixture.projectId, "main");
    expect(tree.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          path: "docs/intro.md",
          status: "modify",
          baseContent: "# Intro\n",
          content: "# Changed",
        }),
        expect.objectContaining({ path: "docs/new.md", status: "add", title: "New" }),
      ]),
    );
    await repository.stageFiles({
      ...input,
      expectedRevision: 1,
      files: [
        { path: "docs/intro.md", content: null },
        { path: "static/img/a.png", content: null },
      ],
    });
    tree = await repository.listWorkingFiles(fixture.projectId, "main");
    expect(tree.files).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "docs/intro.md", status: "delete", content: "" }),
        expect.objectContaining({ path: "static/img/a.png", status: "delete", content: "" }),
      ]),
    );
    await expect(repository.getBranchState(fixture.projectId, "missing")).rejects.toThrow(
      "Branch not found",
    );
  });
  it("rejects malformed operations and collisions without partial application", async () => {
    const fixture = await synchronizedProject();
    const input = {
      projectId: fixture.projectId,
      userId: fixture.operatorId,
      branch: "main",
      expectedRevision: 0,
    };
    await expect(repository.stageFiles({ ...input, files: [] })).rejects.toThrow("Empty");
    await expect(
      repository.stageFiles({ ...input, files: [{ path: "docs/a" }, { path: "docs/a" }] }),
    ).rejects.toThrow("duplicate");
    await expect(repository.stageFiles({ ...input, files: [{ path: "docs/a" }] })).rejects.toThrow(
      "content required",
    );
    await expect(
      repository.stageFiles({
        ...input,
        files: [{ path: "docs/intro.md", content: "# overwrite", createOnly: true }],
      }),
    ).rejects.toThrow("уже существует");
    expect((await repository.listWorkingFiles(fixture.projectId, "main")).files[0]?.content).toBe(
      "# Intro\n",
    );
  });
  it("rejects stale uploads and uploads to a submitting change set", async () => {
    const fixture = await synchronizedProject();
    const input = {
      branch: "main",
      projectId: fixture.projectId,
      mediaType: "image/png",
      originalName: "a.png",
      repositoryPath: "static/img/a.png",
      sha256: "a".repeat(64),
      sizeBytes: 1,
      storageKey: "asset",
      expectedRevision: 0,
    };
    await repository.recordAttachment(input);
    await expect(repository.recordAttachment(input)).rejects.toThrow("обновился");
    const state = await repository.getBranchState(fixture.projectId, "main");
    await database
      .updateTable("change_sets")
      .set({ status: "submitting" })
      .where("id", "=", state.changeSet?.id ?? "")
      .execute();
    await expect(repository.recordAttachment({ ...input, expectedRevision: 1 })).rejects.toThrow(
      "недоступен",
    );
  });
});
