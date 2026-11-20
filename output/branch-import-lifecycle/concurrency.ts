import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { createDatabase, migrateToLatest, PushDocsRepository } from "../../packages/db/src/index";
const exec = promisify(execFile);
const container = `pushdocs-import-check-${randomBytes(5).toString("hex")}`;
let database: ReturnType<typeof createDatabase> | undefined;
try {
  await exec("docker", ["run", "--rm", "-d", "--name", container, "-e", "POSTGRES_HOST_AUTH_METHOD=trust", "-e", "POSTGRES_USER=pushdocs", "-e", "POSTGRES_DB=pushdocs_import_test", "-p", "127.0.0.1::5432", "postgres:17.6-alpine3.22"]);
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await exec("docker", ["exec", container, "pg_isready", "-U", "pushdocs"]); break; }
    catch { if (attempt === 29) throw new Error("Temporary PostgreSQL did not start"); await new Promise(resolve => setTimeout(resolve, 250)); }
  }
  const port = (await exec("docker", ["port", container, "5432/tcp"])).stdout.trim().split(":").at(-1);
  database = createDatabase(`postgres://pushdocs@127.0.0.1:${port}/pushdocs_import_test`);
  await migrateToLatest(database);
  const repository = new PushDocsRepository(database);
  const operator = await repository.createOperator({ displayName: "Fixture", email: "fixture@example.test", passwordHash: "fixture" });
  const connection = await repository.createConnection({ name: "Fixture", baseUrl: "https://fixture.invalid", kind: "gitlab", secretEncrypted: "fixture" });
  const project = await repository.createProject({ connectionId: connection.id, defaultBranch: "main", name: "Fixture", operatorUserId: operator.id, repositoryFullName: "fixture/docs", repositoryProviderId: "42", repositoryUrl: "https://fixture.invalid/docs.git", rootPath: ".", slug: "fixture" });
  const concurrent = await Promise.all(Array.from({length: 10}, (_, index) => index % 2 ? repository.ensureBranchImport(project.id, "docs/new") : repository.enqueueBranchSyncIfStale(project.id, "docs/new")));
  assert.equal(new Set(concurrent).size, 1, "initial import and background refresh must share one job");
  const initialId = concurrent[0];
  assert.ok(initialId);
  const jobs = await database.selectFrom("jobs").selectAll().where("kind", "=", "branch.sync").execute();
  assert.equal(jobs.length, 1);
  await database.updateTable("jobs").set({status:"running", attempts:1}).where("id", "=", initialId).execute();
  const resumed = await Promise.all(Array.from({length: 10}, () => repository.ensureBranchImport(project.id, "docs/new")));
  assert.ok(resumed.every(id => id === initialId));
  await repository.replaceImportedDocuments(project.id, "docs/new", "sha", [], []);
  await repository.completeJob(initialId, 1);
  const completed = await Promise.all(Array.from({length: 10}, () => repository.ensureBranchImport(project.id, "docs/new")));
  assert.ok(completed.every(id => id === null), "completed empty import should not be scheduled again");
  await database.updateTable("branch_contexts").set({updated_at:new Date("2020-01-01")}).where("project_id", "=", project.id).where("full_ref", "=", "docs/new").execute();
  const refreshes = await Promise.all(Array.from({length: 10}, () => repository.enqueueBranchSyncIfStale(project.id, "docs/new")));
  assert.equal(new Set(refreshes).size, 1);
  assert.notEqual(refreshes[0], initialId, "stale imported branch must remain refreshable");
  const explicit = await repository.enqueueBranchSync(project.id, "docs/new");
  assert.notEqual(explicit, refreshes[0], "explicit refresh requests remain independent");
  console.log("PostgreSQL 17: 10 concurrent initial/background requests -> 1 job; running job reused; completed empty import -> no job; 10 stale refreshes -> 1 new job; explicit refresh preserved.");
} finally {
  await database?.destroy();
  await exec("docker", ["rm", "-f", container]).catch(() => undefined);
}
