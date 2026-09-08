import { readFile } from "node:fs/promises";
import { closeDatabase, getDatabase, PushDocsRepository } from "../packages/db/src/index";

if (process.env.DATABASE_URL !== "postgres://pushdocs:pushdocs@localhost:55432/pushdocs")
  throw new Error("Dedicated UI database required");
const db = getDatabase();
const store = new PushDocsRepository(db);
const user = await db
  .selectFrom("users")
  .select("id")
  .where("email", "=", "anna@example.test")
  .executeTakeFirstOrThrow();
const connection = await db
  .selectFrom("provider_connections")
  .select("id")
  .where("base_url", "=", "http://127.0.0.1:4555")
  .executeTakeFirstOrThrow();
const project = await store.createProject({
  connectionId: connection.id,
  name: "Docusaurus preview smoke",
  slug: "preview-smoke",
  defaultBranch: "main",
  operatorUserId: user.id,
  repositoryFullName: "demo/preview",
  repositoryProviderId: "preview",
  repositoryUrl: "http://127.0.0.1:4555/demo/preview.git",
  rootPath: ".",
});
const root = "../../tests/fixtures/docusaurus";
const config = await readFile(`${root}/.pushdocs/config.json`, "utf8");
const content = await readFile(`${root}/docs/intro.mdx`, "utf8");
await store.replaceImportedDocuments(
  project.id,
  "main",
  "1234567890abcdef1234567890abcdef12345678",
  [
    {
      path: "docs/intro.mdx",
      title: "Проверка предпросмотра",
      content,
      locale: "ru",
      version: "current",
      contentHash: "fixture",
    },
    {
      path: ".pushdocs/config.json",
      title: "Настройки",
      content: config,
      locale: "ru",
      version: "current",
      contentHash: "fixture",
    },
  ],
);
await store.stageFiles({
  projectId: project.id,
  userId: user.id,
  branch: "main",
  expectedRevision: 0,
  files: [
    {
      path: "docs/intro.mdx",
      content: content.replace("Документ из Git", "Черновик до первого коммита"),
    },
  ],
});
console.log(`http://localhost:3000/projects/${project.id}/preview?branch=main`);
await closeDatabase();
