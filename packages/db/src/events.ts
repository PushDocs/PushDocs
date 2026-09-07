import type { Kysely, Transaction } from "kysely";
import type { Database } from "./schema";

export interface EventInput {
  entityId: string;
  payload?: unknown;
  projectId?: string;
  recipientUserId?: string;
  revision: number;
  type: string;
}

export async function appendEvent(
  transaction: Transaction<Database> | Kysely<Database>,
  input: EventInput,
): Promise<number> {
  const counter = await transaction
    .updateTable("instance_state")
    .set((expression) => ({ event_counter: expression("event_counter", "+", 1) }))
    .where("singleton", "=", true)
    .returning("event_counter")
    .executeTakeFirstOrThrow();

  await transaction
    .insertInto("domain_events")
    .values({
      entity_id: input.entityId,
      payload: input.payload ?? {},
      project_id: input.projectId ?? null,
      recipient_user_id: input.recipientUserId ?? null,
      revision: input.revision,
      sequence: counter.event_counter,
      type: input.type,
    })
    .execute();
  return Number(counter.event_counter);
}
