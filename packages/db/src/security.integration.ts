// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Explicit local integration test environment.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { sql } from "kysely";
import { decryptSecret } from "./crypto";
import { createDatabase } from "./database";
import { migrateToLatest } from "./migrations";
import { PushDocsRepository } from "./repository";
import { totpCode } from "./totp";

const address = process.env.PUSHDOCS_TEST_DATABASE_URL;
if (!address)
  throw new Error("Set PUSHDOCS_TEST_DATABASE_URL to a disposable local PostgreSQL server");
const url = new URL(address);
if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))
  throw new Error("Only local PostgreSQL is accepted");
const name = `pushdocs_security_${randomBytes(10).toString("hex")}`;
const admin = createDatabase(address);
await sql.raw(`create database ${name}`).execute(admin);
url.pathname = `/${name}`;
const db = createDatabase(url.toString());
process.env.PUSHDOCS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
try {
  await migrateToLatest(db);
  const repo = new PushDocsRepository(db);
  const owner = await repo.createOperator({
    displayName: "Old owner",
    email: "owner@example.test",
    passwordHash: "hash",
  });
  const reader = await repo.createUser({
    displayName: "Reader",
    email: "reader@example.test",
    passwordHash: "hash",
  });
  const connection = await repo.createConnection({
    name: "Fixture",
    baseUrl: "https://fixture.invalid",
    kind: "gitlab",
    secretEncrypted: "unused",
  });
  const project = await repo.createProject({
    connectionId: connection.id,
    defaultBranch: "main",
    name: "Fixture",
    operatorUserId: owner.id,
    repositoryFullName: "fixture/docs",
    repositoryProviderId: "1",
    repositoryUrl: "https://fixture.invalid/docs.git",
    rootPath: ".",
    slug: "fixture",
  });
  await repo.createInvitation({
    email: "reader@example.test",
    invitedByUserId: owner.id,
    projectId: project.id,
    role: "reader",
    tokenHash: "single-use",
  });
  await repo.createSession(owner.id, "old-owner-session", new Date(Date.now() + 60_000));
  await repo.createSession(reader.id, "old-reader-session", new Date(Date.now() + 60_000));

  // Recreate the pre-upgrade schema only in the randomly named disposable database.
  await sql`alter table users drop column totp_secret, drop column totp_pending_secret,
    drop column totp_pending_expires_at, drop column totp_last_counter, drop column auth_attempts,
    drop column auth_window_at, drop column legacy_password_login`.execute(db);
  await sql`alter table sessions drop column purpose, drop column mfa_verified`.execute(db);
  await sql`update project_invitations set expires_at = created_at + interval '7 days'`.execute(db);
  await sql`delete from kysely_migration where name = '011-two-factor'`.execute(db);
  await migrateToLatest(db);
  assert.ok(await repo.findUserBySessionHash("old-owner-session"));
  assert.equal(await repo.findUserBySessionHash("old-reader-session"), undefined);
  assert.equal((await repo.getSecurityUser(owner.id))?.legacy_password_login, true);
  assert.equal((await repo.getSecurityUser(reader.id))?.legacy_password_login, false);
  const invitation = await db
    .selectFrom("project_invitations")
    .selectAll()
    .executeTakeFirstOrThrow();
  assert.equal(invitation.expires_at.getTime() - invitation.created_at.getTime(), 24 * 60 * 60_000);
  const accepts = await Promise.allSettled([
    repo.acceptInvitation("single-use", reader.id),
    repo.acceptInvitation("single-use", reader.id),
  ]);
  assert.equal(accepts.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(await repo.getInvitation("single-use"), undefined);

  await repo.beginTotpSetup(owner.id);
  const user = await repo.getSecurityUser(owner.id);
  const secret = decryptSecret(user?.totp_pending_secret ?? "", `${owner.id}:totp:pending`);
  const code = totpCode(secret, Date.now());
  const verifies = await Promise.all([
    repo.consumeTotp(owner.id, code, true),
    repo.consumeTotp(owner.id, code, true),
  ]);
  assert.equal(verifies.filter(Boolean).length, 1);
  assert.equal(await repo.findUserBySessionHash("old-owner-session"), undefined);
  assert.equal(await repo.consumeTotp(owner.id, code), false);
  assert.equal((await repo.getSecurityUser(owner.id))?.legacy_password_login, false);
  await repo.createSession(owner.id, "verified", new Date(Date.now() + 60_000), "full", true);
  assert.ok(await repo.findUserBySessionHash("verified"));
  assert.equal(await repo.changePassword(owner.id, "hash", "new-hash"), true);
  assert.equal(await repo.findUserBySessionHash("verified"), undefined);
  const attempts = await Promise.all(
    Array.from({ length: 20 }, () => repo.takeAuthAttempt(reader.id)),
  );
  assert.equal(attempts.filter(Boolean).length, 10);
  console.log(
    "PASS: upgrade compatibility, 24-hour invites, concurrent single-use acceptance, TOTP replay protection, session revocation and persistent attempt limits",
  );
} finally {
  await db.destroy();
  await sql.raw(`drop database ${name}`).execute(admin);
  await admin.destroy();
}
