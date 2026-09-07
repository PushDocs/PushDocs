import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { getDatabase, hashOpaqueToken, PushDocsRepository } from "@pushdocs/db";

const port = Number(process.env.PORT ?? 4100);
const database = getDatabase();
const repository = new PushDocsRepository(database);

function cookie(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

function sendEvent(
  response: ServerResponse,
  event: { data: unknown; id?: number; type?: string },
): void {
  if (event.id !== undefined) response.write(`id: ${event.id}\n`);
  if (event.type) response.write(`event: ${event.type}\n`);
  response.write(`data: ${JSON.stringify(event.data)}\n\n`);
}

async function events(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const token = cookie(request, "pushdocs_session");
  const user = token ? await repository.findUserBySessionHash(hashOpaqueToken(token)) : undefined;
  if (!user) {
    response.writeHead(401).end();
    return;
  }
  response.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "Content-Type": "text/event-stream",
    "X-Accel-Buffering": "no",
  });
  let cursor = Number(request.headers["last-event-id"] ?? 0);
  let running = false;
  sendEvent(response, { data: { cursor }, type: "connected" });

  const poll = async () => {
    if (running || response.destroyed) return;
    running = true;
    try {
      const rows = await database
        .selectFrom("domain_events")
        .leftJoin(
          "project_memberships",
          "project_memberships.project_id",
          "domain_events.project_id",
        )
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
            expression("domain_events.recipient_user_id", "=", user.id),
            expression("project_memberships.user_id", "=", user.id),
          ]),
        )
        .orderBy("domain_events.sequence")
        .limit(100)
        .execute();
      for (const row of rows) {
        cursor = Number(row.sequence);
        sendEvent(response, {
          data: {
            entityId: row.entity_id,
            payload: row.payload,
            projectId: row.project_id,
            revision: row.revision,
          },
          id: cursor,
          type: row.type,
        });
      }
    } catch (error) {
      console.error("Realtime poll failed", error);
    } finally {
      running = false;
    }
  };

  await poll();
  const pollTimer = setInterval(poll, 2000);
  const heartbeat = setInterval(() => response.write(": heartbeat\n\n"), 20_000);
  request.on("close", () => {
    clearInterval(pollTimer);
    clearInterval(heartbeat);
  });
}

const server = createServer((request, response) => {
  if (request.url === "/health/ready") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }
  if (request.url?.startsWith("/events")) {
    void events(request, response);
    return;
  }
  response.writeHead(404).end();
});

server.listen(port, "0.0.0.0", () => {
  console.log(`PushDocs realtime listening on ${port}`);
});
