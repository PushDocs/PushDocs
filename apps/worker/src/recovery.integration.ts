import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { createDatabase, migrateToLatest, PushDocsRepository } from "@pushdocs/db";
import type { GitProvider } from "@pushdocs/providers";
import { sql } from "kysely";
import { GitTransport } from "./git-transport";
import { createWorkerService } from "./service";

// Explicit opt-in only. Never use DATABASE_URL or any configured provider connection.
const address = process.env.PUSHDOCS_TEST_DATABASE_URL;
if (!address)
  throw new Error("Set PUSHDOCS_TEST_DATABASE_URL to a local disposable PostgreSQL server");
const url = new URL(address);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Integration tests only accept a local PostgreSQL server");
const name = `pushdocs_test_${randomBytes(10).toString("hex")}`;
const admin = createDatabase(address);
await sql.raw(`create database ${name}`).execute(admin);
url.pathname = `/${name}`;
const database = createDatabase(url.toString());
const directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-recovery-"));
const exec = promisify(execFile);
async function git(cwd: string, ...args: string[]) {
  return (
    await exec("git", ["-C", cwd, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_TERMINAL_PROMPT: "0",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
      },
    })
  ).stdout.trim();
}

try {
  await migrateToLatest(database);
  const repository = new PushDocsRepository(database);
  const operator = await repository.createOperator({
    displayName: "Fixture",
    email: "fixture@example.test",
    passwordHash: "not-a-password",
  });
  const connection = await repository.createConnection({
    name: "Offline fixture",
    baseUrl: "https://fixture.invalid",
    kind: "gitlab",
    secretEncrypted: "fixture",
  });
  const project = await repository.createProject({
    connectionId: connection.id,
    defaultBranch: "main",
    name: "Recovery fixture",
    operatorUserId: operator.id,
    repositoryFullName: "fixture/docs",
    repositoryProviderId: "1",
    repositoryUrl: "https://fixture.invalid/docs.git",
    rootPath: ".",
    slug: "recovery-fixture",
  });
  const remote = path.join(directory, "remote.git");
  const source = path.join(directory, "source");
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  await exec("git", ["clone", remote, source]);
  await writeFile(path.join(source, "intro.md"), "# Original\r\n");
  await git(source, "add", ".");
  await git(source, "commit", "-m", "Initial");
  await git(source, "push", "origin", "HEAD:refs/heads/main", "HEAD:refs/heads/docs/update");
  const baseSha = await git(source, "rev-parse", "HEAD");
  await repository.replaceImportedDocuments(project.id, "docs/update", baseSha, [
    {
      path: "intro.md",
      content: "# Original\r\n",
      contentHash: "fixture",
      title: "Original",
      locale: "default",
      version: "current",
    },
  ]);
  const draft = await repository.saveDraft({
    projectId: project.id,
    branch: "docs/update",
    userId: operator.id,
    path: "intro.md",
    content: "# Edited\r\n<Callout />\r\n",
    expectedRevision: 0,
    baseCommitSha: baseSha,
  });
  await repository.queueChangeSetSubmission({
    projectId: project.id,
    changeSetId: draft.changeSetId,
    userId: operator.id,
    message: "Edit",
    createReview: true,
  });
  let reviewUnavailable = true;
  let reviewCreated = false;
  const review = {
    id: "fixture-review",
    headSha: "",
    sourceBranch: "docs/update",
    targetBranch: "main",
    state: "open" as const,
    title: "Edit",
    url: "https://fixture.invalid/review",
  };
  const markSubmitted = repository.markChangeSetSubmitted.bind(repository);
  let acknowledgeUnavailable = true;
  repository.markChangeSetSubmitted = async (input) => {
    if (acknowledgeUnavailable)
      throw new Error("Simulated journal outage after Git accepted the commit");
    await markSubmitted(input);
  };
  const provider = {
    kind: "gitlab",
    listBranches: async () => [
      { name: "main", sha: baseSha },
      { name: "docs/update", sha: await git(remote, "rev-parse", "refs/heads/docs/update") },
    ],
    listFiles: async () => ["intro.md"],
    readFile: async (_repositoryId: string, ref: string, filePath: string) =>
      (await exec("git", ["-C", remote, "show", `${ref}:${filePath}`])).stdout,
    listChangeRequests: async () => (reviewCreated ? [review] : []),
    getChangeRequestDetails: async () => ({
      headSha: review.headSha,
      readiness: { state: "ready", reason: null },
      labels: [],
      approvals: null,
      comments: [],
      commentsComplete: true,
    }),
    listChecks: async () => [],
    ensureChangeRequest: async () => {
      if (reviewUnavailable)
        throw new Error("Simulated provider outage after Git accepted the commit");
      reviewCreated = true;
      return review;
    },
  } as unknown as GitProvider;
  const makeWorker = (cache: string) =>
    createWorkerService({
      repository,
      createProvider: () => provider,
      decryptSecret: () => "no-real-token",
      gitRoot: path.join(directory, cache),
      createGitTransport: (input) => new GitTransport({ ...input, remote, allowLocal: true }),
      logger: { error: () => undefined },
    });
  const payload = {
    projectId: project.id,
    changeSetId: draft.changeSetId,
    userId: operator.id,
    message: "Edit",
    createReview: true,
    operationId: "recovery",
    createdAt: "2026-09-08T00:00:00Z",
  };
  await assert.rejects(
    makeWorker("first-cache").submitChangeSet(payload),
    /Simulated journal outage/,
  );
  const interrupted = await repository.getChangeSetSubmission(draft.changeSetId);
  assert.equal(interrupted?.status, "submitting");
  assert.ok(interrupted?.prepared_commit);
  const accepted = await git(remote, "rev-parse", "refs/heads/docs/update");
  acknowledgeUnavailable = false;
  const restarted = makeWorker("fresh-cache");
  await restarted.submitChangeSet(payload);
  const retry = await database
    .selectFrom("jobs")
    .selectAll()
    .where("kind", "=", "review.create")
    .executeTakeFirstOrThrow();
  assert.equal(retry.status, "queued");
  assert.equal(reviewCreated, false);
  reviewUnavailable = false;
  review.headSha = accepted;
  // Drain project/branch synchronization, the original submission and review retries.
  for (let index = 0; index < 10; index += 1) {
    if (!(await restarted.runJob())) break;
  }
  const jobs = await database.selectFrom("jobs").selectAll().execute();
  assert.equal(jobs.find((job) => job.id === retry.id)?.status, "done");
  assert.ok(
    jobs.every((job) => job.status === "done"),
    JSON.stringify(
      jobs.map((job) => ({
        kind: job.kind,
        status: job.status,
        error: job.last_error,
      })),
    ),
  );
  assert.equal(reviewCreated, true);
  assert.equal((await repository.listChangeRequests(project.id, "open")).length, 1);
  assert.equal((await repository.getChangeSetSubmission(draft.changeSetId))?.status, "submitted");
  assert.equal(await git(remote, "rev-parse", "refs/heads/docs/update"), accepted);
  assert.equal(await git(remote, "rev-list", "--count", "docs/update"), "2");
  assert.equal(
    (await exec("git", ["-C", remote, "show", "docs/update:intro.md"])).stdout,
    "# Edited\r\n<Callout />\r\n",
  );

  let active = 0;
  let maximum = 0;
  await Promise.all(
    Array.from({ length: 3 }, () =>
      repository.withGitRefLock("same-repository:main", async () => {
        active += 1;
        maximum = Math.max(maximum, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      }),
    ),
  );
  assert.equal(maximum, 1);
  const reservations = await Promise.allSettled(
    Array.from({ length: 5 }, () =>
      repository.beginUpload({
        projectId: project.id,
        branch: "docs/update",
        expectedRevision: 0,
        userId: operator.id,
      }),
    ),
  );
  assert.equal(reservations.filter((result) => result.status === "fulfilled").length, 4);
  assert.equal(reservations.filter((result) => result.status === "rejected").length, 1);
  for (const result of reservations)
    if (result.status === "fulfilled") await repository.finishUpload(result.value.id, project.id);
  const writes = await Promise.allSettled(
    ["First", "Second"].map((content) =>
      repository.stageFiles({
        projectId: project.id,
        branch: "docs/update",
        userId: operator.id,
        expectedRevision: 0,
        files: [{ path: "intro.md", content }],
      }),
    ),
  );
  assert.equal(writes.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(writes.filter((result) => result.status === "rejected").length, 1);
  console.log(
    "PASS: PostgreSQL journal recovery, independent review retry, exact Git bytes, no duplicate commit, cross-connection ref lock, upload limit and optimistic write race",
  );
} finally {
  await database.destroy();
  await sql.raw(`drop database ${name}`).execute(admin);
  await admin.destroy();
  await rm(directory, { recursive: true, force: true });
}
