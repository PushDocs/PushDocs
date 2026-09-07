import { Kysely, PostgresDialect, sql } from "kysely";
import { Pool } from "pg";
import type { Database } from "./schema";

let database: Kysely<Database> | undefined;

export function createDatabase(connectionString = process.env.DATABASE_URL): Kysely<Database> {
  if (!connectionString) throw new Error("DATABASE_URL is required");
  return new Kysely<Database>({
    dialect: new PostgresDialect({
      pool: new Pool({
        connectionString,
        max: Number(process.env.PUSHDOCS_DB_POOL_SIZE ?? 10),
      }),
    }),
  });
}

export function getDatabase(): Kysely<Database> {
  database ??= createDatabase();
  return database;
}

export async function closeDatabase(): Promise<void> {
  if (!database) return;
  await database.destroy();
  database = undefined;
}

export async function checkDatabase(db = getDatabase()): Promise<void> {
  await sql`select 1`.execute(db);
}
