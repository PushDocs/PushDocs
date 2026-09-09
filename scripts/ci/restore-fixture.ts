// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: This fixture runs directly, outside Turbo.
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import {
  createDatabase,
  decryptSecret,
  encryptSecret,
  PushDocsRepository,
} from "../../packages/db/src/index";

// Only called inside the temporary Compose project created by compose-smoke.sh.
if (process.env.PUSHDOCS_CI_FIXTURE !== "1") throw new Error("CI fixture opt-in required");
const database = createDatabase();
const repository = new PushDocsRepository(database);
const content = "# Uncommitted CI draft\r\n\r\n<Callout />\r\n";
const attachment = Buffer.from([0, 255, 13, 10, 42]);

try {
  if (process.argv[2] === "seed") {
    const operator = await repository.findUserByEmail("operator@example.test");
    assert.ok(operator);
    const connection = await repository.createConnection({
      name: "CI encrypted connection",
      kind: "gitlab",
      baseUrl: "https://fixture.invalid",
      secretEncrypted: encryptSecret("synthetic-ci-token"),
    });
    const project = await repository.createProject({
      connectionId: connection.id,
      defaultBranch: "main",
      name: "CI restore fixture",
      operatorUserId: operator.id,
      repositoryFullName: "ci/docs",
      repositoryProviderId: "1",
      repositoryUrl: "https://fixture.invalid/ci/docs.git",
      rootPath: ".",
      slug: "ci-restore",
    });
    const sha = "a".repeat(40);
    await repository.replaceImportedDocuments(project.id, "main", sha, [
      {
        path: "docs/intro.mdx",
        content: "# Original\n",
        contentHash: "fixture",
        title: "Introduction",
        locale: "default",
        version: "current",
      },
    ]);
    await repository.saveDraft({
      projectId: project.id,
      branch: "main",
      userId: operator.id,
      path: "docs/intro.mdx",
      content,
      expectedRevision: 0,
      baseCommitSha: sha,
    });
    await writeFile("/data/attachments/ci-restore.bin", attachment);
  } else if (process.argv[2] === "verify") {
    const connection = await database
      .selectFrom("provider_connections")
      .selectAll()
      .where("name", "=", "CI encrypted connection")
      .executeTakeFirstOrThrow();
    assert.equal(decryptSecret(connection.secret_encrypted), "synthetic-ci-token");
    const drafts = await database.selectFrom("draft_files").selectAll().execute();
    assert.equal(drafts.length, 1);
    assert.equal(drafts[0]?.content, content);
    assert.deepEqual(await readFile("/data/attachments/ci-restore.bin"), attachment);
    console.log("PASS: restored draft bytes, encrypted connection and attachment bytes");
  } else {
    throw new Error("Expected seed or verify");
  }
} finally {
  await database.destroy();
}
