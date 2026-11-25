import { randomUUID } from "node:crypto";
import { Kysely, PostgresDialect, sql } from "kysely";
import type { Pool } from "pg";
import { DataType, newDb } from "pg-mem";
import { migrateToLatest } from "../../packages/db/src/migrations";
import type { Database } from "../../packages/db/src/schema";

export async function createMemoryDatabase(): Promise<Kysely<Database>> {
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
