import { createServer } from "node:http";
import { getDatabase, hashOpaqueToken, PushDocsRepository } from "@pushdocs/db";
import { createRealtimeHandler } from "./service";

const port = Number(process.env.PORT ?? 4100);
const database = getDatabase();
const repository = new PushDocsRepository(database);

const handler = createRealtimeHandler({
  findUserByToken: (token) => repository.findUserBySessionHash(hashOpaqueToken(token)),
  getCurrentCursor: async () => {
    const state = await database
      .selectFrom("instance_state")
      .select("event_counter")
      .where("singleton", "=", true)
      .executeTakeFirst();
    return Number(state?.event_counter ?? 0);
  },
  listEvents: (userId, cursor, projectId) => {
    let query = database
      .selectFrom("domain_events")
      .leftJoin("project_memberships", "project_memberships.project_id", "domain_events.project_id")
      .select([
        "domain_events.sequence",
        "domain_events.type",
        "domain_events.entity_id",
        "domain_events.project_id",
        "domain_events.payload",
        "domain_events.revision",
      ])
      .where("domain_events.sequence", ">", cursor)
      .where((expression) =>
        expression.or([
          expression("domain_events.recipient_user_id", "=", userId),
          expression("project_memberships.user_id", "=", userId),
        ]),
      );
    if (projectId)
      query = query.where((expression) =>
        expression.or([
          expression("domain_events.project_id", "=", projectId),
          expression.and([
            expression("domain_events.project_id", "is", null),
            expression("domain_events.recipient_user_id", "=", userId),
          ]),
        ]),
      );
    return query.orderBy("domain_events.sequence").limit(100).execute();
  },
});

createServer(handler).listen(port, "0.0.0.0", () => {
  console.log(`PushDocs realtime listening on ${port}`);
});
