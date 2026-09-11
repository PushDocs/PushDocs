import type { Kysely } from "kysely";
import { decryptSecret, encryptSecret } from "./crypto";
import type { Database } from "./schema";
import { generateTotpSecret, verifyTotp } from "./totp";

export class SecurityRepository {
  constructor(protected readonly database: Kysely<Database>) {}

  async getSecurityUser(userId: string) {
    return this.database
      .selectFrom("users")
      .selectAll()
      .where("id", "=", userId)
      .where("status", "=", "active")
      .executeTakeFirst();
  }

  // Persistent, account-wide budget shared by password, setup and TOTP attempts.
  async takeAuthAttempt(userId: string): Promise<boolean> {
    return this.database.transaction().execute(async (db) => {
      const user = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", userId)
        .forUpdate()
        .executeTakeFirst();
      if (user?.status !== "active") return false;
      const now = new Date();
      const fresh =
        !user.auth_window_at || now.getTime() - user.auth_window_at.getTime() >= 15 * 60_000;
      if (!fresh && user.auth_attempts >= 10) return false;
      await db
        .updateTable("users")
        .set({
          auth_attempts: fresh ? 1 : user.auth_attempts + 1,
          auth_window_at: fresh ? now : user.auth_window_at,
        })
        .where("id", "=", userId)
        .execute();
      return true;
    });
  }

  async beginTotpSetup(userId: string): Promise<void> {
    await this.database.transaction().execute(async (db) => {
      const user = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", userId)
        .forUpdate()
        .executeTakeFirstOrThrow();
      if (user.totp_secret) return;
      if (
        user.totp_pending_secret &&
        user.totp_pending_expires_at &&
        user.totp_pending_expires_at > new Date()
      )
        return;
      await db
        .updateTable("users")
        .set({
          totp_pending_secret: encryptSecret(generateTotpSecret(), `${userId}:totp:pending`),
          totp_pending_expires_at: new Date(Date.now() + 15 * 60_000),
        })
        .where("id", "=", userId)
        .execute();
    });
  }

  async consumeTotp(userId: string, code: string, setup = false): Promise<boolean> {
    if (!(await this.takeAuthAttempt(userId))) return false;
    return this.database.transaction().execute(async (db) => {
      const user = await db
        .selectFrom("users")
        .selectAll()
        .where("id", "=", userId)
        .where("status", "=", "active")
        .forUpdate()
        .executeTakeFirst();
      if (!user) return false;
      if (
        setup &&
        (user.totp_secret ||
          !user.totp_pending_expires_at ||
          user.totp_pending_expires_at <= new Date())
      )
        return false;
      const encrypted = setup ? user.totp_pending_secret : user.totp_secret;
      if (!encrypted) return false;
      const secret = decryptSecret(encrypted, `${userId}:totp:${setup ? "pending" : "active"}`);
      const counter = verifyTotp(secret, code);
      if (counter === null || counter <= user.totp_last_counter) return false;
      await db
        .updateTable("users")
        .set({
          totp_last_counter: counter,
          auth_attempts: 0,
          auth_window_at: null,
          ...(setup
            ? {
                totp_secret: encryptSecret(secret, `${userId}:totp:active`),
                totp_pending_secret: null,
                totp_pending_expires_at: null,
                legacy_password_login: false,
              }
            : {}),
        })
        .where("id", "=", userId)
        .execute();
      if (setup) await db.deleteFrom("sessions").where("user_id", "=", userId).execute();
      return true;
    });
  }

  async getAuthenticationSession(tokenHash: string) {
    return this.database
      .selectFrom("sessions")
      .innerJoin("users", "users.id", "sessions.user_id")
      .select([
        "users.id",
        "users.email",
        "users.totp_secret",
        "users.totp_pending_secret",
        "users.totp_pending_expires_at",
        "sessions.purpose",
      ])
      .where("sessions.token_hash", "=", tokenHash)
      .where("sessions.expires_at", ">", new Date())
      .where("users.status", "=", "active")
      .executeTakeFirst();
  }

  async changePassword(
    userId: string,
    expectedHash: string,
    passwordHash: string,
  ): Promise<boolean> {
    return this.database.transaction().execute(async (db) => {
      const updated = await db
        .updateTable("users")
        .set({ password_hash: passwordHash })
        .where("id", "=", userId)
        .where("password_hash", "=", expectedHash)
        .returning("id")
        .executeTakeFirst();
      if (!updated) return false;
      await db.deleteFrom("sessions").where("user_id", "=", userId).execute();
      return true;
    });
  }
}
