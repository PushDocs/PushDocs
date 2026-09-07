import type { IncomingMessage, ServerResponse } from "node:http";

export interface RealtimeEvent {
  entity_id: string;
  payload: unknown;
  project_id: string | null;
  revision: number;
  sequence: number | string | bigint;
  type: string;
}

export interface RealtimeServiceOptions {
  clearInterval?: (handle: ReturnType<typeof globalThis.setInterval>) => void;
  findUserByToken: (token: string) => Promise<{ id: string } | undefined>;
  listEvents: (userId: string, cursor: number) => Promise<RealtimeEvent[]>;
  logger?: Pick<Console, "error">;
  setInterval?: (
    callback: () => void | Promise<void>,
    delay: number,
  ) => ReturnType<typeof globalThis.setInterval>;
}

export function cookieValue(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const item of header.split(";")) {
    const [key, ...parts] = item.trim().split("=");
    if (key === name) return decodeURIComponent(parts.join("="));
  }
  return undefined;
}

export function formatSseEvent(event: { data: unknown; id?: number; type?: string }): string {
  const lines: string[] = [];
  if (event.id !== undefined) lines.push(`id: ${event.id}`);
  if (event.type) lines.push(`event: ${event.type}`);
  lines.push(`data: ${JSON.stringify(event.data)}`);
  return `${lines.join("\n")}\n\n`;
}

export function lastEventCursor(value: string | readonly string[] | undefined): number {
  const parsed = Number(Array.isArray(value) ? value[0] : (value ?? 0));
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

export function createRealtimeHandler(options: RealtimeServiceOptions) {
  const schedule =
    options.setInterval ??
    ((callback: () => void | Promise<void>, delay: number) =>
      globalThis.setInterval(callback, delay));
  const cancel =
    options.clearInterval ??
    ((handle: ReturnType<typeof globalThis.setInterval>) => globalThis.clearInterval(handle));
  const logger = options.logger ?? console;

  async function events(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const token = cookieValue(request.headers.cookie, "pushdocs_session");
    const user = token ? await options.findUserByToken(token) : undefined;
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
    let cursor = lastEventCursor(request.headers["last-event-id"]);
    let running = false;
    response.write(formatSseEvent({ data: { cursor }, type: "connected" }));

    const poll = async () => {
      if (running || response.destroyed) return;
      running = true;
      try {
        const rows = await options.listEvents(user.id, cursor);
        for (const row of rows) {
          cursor = Number(row.sequence);
          response.write(
            formatSseEvent({
              data: {
                entityId: row.entity_id,
                payload: row.payload,
                projectId: row.project_id,
                revision: row.revision,
              },
              id: cursor,
              type: row.type,
            }),
          );
        }
      } catch (error) {
        logger.error("Realtime poll failed", error);
      } finally {
        running = false;
      }
    };

    await poll();
    const pollTimer = schedule(poll, 2000);
    const heartbeat = schedule(() => {
      response.write(": heartbeat\n\n");
    }, 20_000);
    request.on("close", () => {
      cancel(pollTimer);
      cancel(heartbeat);
    });
  }

  return (request: IncomingMessage, response: ServerResponse): void => {
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
  };
}
