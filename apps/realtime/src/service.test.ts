import { EventEmitter } from "node:events";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { cookieValue, createRealtimeHandler, formatSseEvent, lastEventCursor } from "./service";

function request(url: string, headers: IncomingMessage["headers"] = {}): IncomingMessage {
  return Object.assign(new EventEmitter(), { headers, url }) as IncomingMessage;
}

function response() {
  const value = {
    destroyed: false,
    end: vi.fn(),
    headers: undefined as unknown,
    status: undefined as number | undefined,
    write: vi.fn(),
    writeHead: vi.fn((status: number, headers?: unknown) => {
      value.status = status;
      value.headers = headers;
      return value;
    }),
  };
  value.end.mockImplementation(() => value);
  return value as unknown as ServerResponse & typeof value;
}

function scheduler() {
  const callbacks: Array<() => void | Promise<void>> = [];
  const delays: number[] = [];
  const setInterval = vi.fn((callback: () => void | Promise<void>, delay: number) => {
    callbacks.push(callback);
    delays.push(delay);
    return callbacks.length as unknown as ReturnType<typeof globalThis.setInterval>;
  });
  return { callbacks, clearInterval: vi.fn(), delays, setInterval };
}

describe("SSE formatting", () => {
  it("reads encoded cookies and values containing equals signs", () => {
    expect(cookieValue("theme=dark; pushdocs_session=a%3Db%3D; empty=", "pushdocs_session")).toBe(
      "a=b=",
    );
    expect(cookieValue("theme=dark", "pushdocs_session")).toBeUndefined();
    expect(cookieValue(undefined, "pushdocs_session")).toBeUndefined();
  });

  it("formats complete and data-only events", () => {
    expect(formatSseEvent({ data: { ok: true }, id: 7, type: "updated" })).toBe(
      'id: 7\nevent: updated\ndata: {"ok":true}\n\n',
    );
    expect(formatSseEvent({ data: null })).toBe("data: null\n\n");
  });

  it.each([
    [undefined, 0],
    ["", 0],
    ["7", 7],
    [["8", "9"], 8],
    ["-1", 0],
    ["invalid", 0],
    ["1.5", 0],
  ] as const)("normalizes cursor %j", (input, expected) => {
    expect(lastEventCursor(input)).toBe(expected);
  });
});

describe("realtime request handler", () => {
  it("serves readiness and not found responses", () => {
    const handler = createRealtimeHandler({
      findUserByToken: vi.fn(),
      listEvents: vi.fn(),
    });
    const ready = response();
    handler(request("/health/ready"), ready);
    expect(ready.status).toBe(200);
    expect(ready.end).toHaveBeenCalledWith('{"status":"ok"}');

    const missing = response();
    handler(request("/missing"), missing);
    expect(missing.status).toBe(404);
    expect(missing.end).toHaveBeenCalled();
  });

  it("rejects missing and invalid sessions", async () => {
    const findUserByToken = vi.fn().mockResolvedValue(undefined);
    const handler = createRealtimeHandler({ findUserByToken, listEvents: vi.fn() });
    const withoutCookie = response();
    handler(request("/events"), withoutCookie);
    await vi.waitFor(() => expect(withoutCookie.status).toBe(401));
    expect(findUserByToken).not.toHaveBeenCalled();

    const invalid = response();
    handler(request("/events", { cookie: "pushdocs_session=invalid" }), invalid);
    await vi.waitFor(() => expect(invalid.status).toBe(401));
    expect(findUserByToken).toHaveBeenCalledWith("invalid");
  });

  it("streams visible events after the requested cursor", async () => {
    const timers = scheduler();
    const listEvents = vi.fn().mockResolvedValue([
      {
        entity_id: "document",
        payload: { path: "docs/a.md" },
        project_id: "project",
        revision: 3,
        sequence: "12",
        type: "document.updated",
      },
    ]);
    const handler = createRealtimeHandler({
      clearInterval: timers.clearInterval,
      findUserByToken: vi.fn().mockResolvedValue({ id: "user" }),
      listEvents,
      setInterval: timers.setInterval,
    });
    const stream = response();
    handler(
      request("/events?project=one", {
        cookie: "pushdocs_session=token",
        "last-event-id": "10",
      }),
      stream,
    );

    await vi.waitFor(() => expect(stream.write).toHaveBeenCalledTimes(2));
    expect(stream.status).toBe(200);
    expect(stream.headers).toMatchObject({
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      "X-Accel-Buffering": "no",
    });
    expect(listEvents).toHaveBeenCalledWith("user", 10);
    expect(stream.write).toHaveBeenNthCalledWith(1, 'event: connected\ndata: {"cursor":10}\n\n');
    expect(stream.write).toHaveBeenNthCalledWith(
      2,
      'id: 12\nevent: document.updated\ndata: {"entityId":"document","payload":{"path":"docs/a.md"},"projectId":"project","revision":3}\n\n',
    );
    expect(timers.delays).toEqual([2000, 20_000]);
  });

  it("sends heartbeats and clears both timers when the client closes", async () => {
    const timers = scheduler();
    const incoming = request("/events", { cookie: "pushdocs_session=token" });
    const stream = response();
    createRealtimeHandler({
      clearInterval: timers.clearInterval,
      findUserByToken: vi.fn().mockResolvedValue({ id: "user" }),
      listEvents: vi.fn().mockResolvedValue([]),
      setInterval: timers.setInterval,
    })(incoming, stream);
    await vi.waitFor(() => expect(timers.callbacks).toHaveLength(2));
    timers.callbacks[1]?.();
    expect(stream.write).toHaveBeenCalledWith(": heartbeat\n\n");
    incoming.emit("close");
    expect(timers.clearInterval).toHaveBeenNthCalledWith(1, 1);
    expect(timers.clearInterval).toHaveBeenNthCalledWith(2, 2);
  });

  it("logs polling errors and continues on the next interval", async () => {
    const timers = scheduler();
    const logger = { error: vi.fn() };
    const listEvents = vi
      .fn()
      .mockRejectedValueOnce(new Error("database unavailable"))
      .mockResolvedValueOnce([]);
    createRealtimeHandler({
      findUserByToken: vi.fn().mockResolvedValue({ id: "user" }),
      listEvents,
      logger,
      setInterval: timers.setInterval,
    })(request("/events", { cookie: "pushdocs_session=token" }), response());
    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledWith("Realtime poll failed", expect.any(Error)),
    );
    await timers.callbacks[0]?.();
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it("does not overlap polls and stops polling a destroyed response", async () => {
    const timers = scheduler();
    let release: (() => void) | undefined;
    const listEvents = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementationOnce(
        () =>
          new Promise<void>((resolve) => {
            release = resolve;
          }),
      );
    const stream = response();
    createRealtimeHandler({
      findUserByToken: vi.fn().mockResolvedValue({ id: "user" }),
      listEvents,
      setInterval: timers.setInterval,
    })(request("/events", { cookie: "pushdocs_session=token" }), stream);
    await vi.waitFor(() => expect(timers.callbacks).toHaveLength(2));
    const pending = timers.callbacks[0]?.();
    await timers.callbacks[0]?.();
    expect(listEvents).toHaveBeenCalledTimes(2);
    release?.();
    await pending;
    Object.defineProperty(stream, "destroyed", { value: true });
    await timers.callbacks[0]?.();
    expect(listEvents).toHaveBeenCalledTimes(2);
  });

  it("uses platform timers when no scheduler is supplied", async () => {
    vi.useFakeTimers();
    try {
      const incoming = request("/events", { cookie: "pushdocs_session=token" });
      const stream = response();
      createRealtimeHandler({
        findUserByToken: vi.fn().mockResolvedValue({ id: "user" }),
        listEvents: vi.fn().mockResolvedValue([]),
      })(incoming, stream);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      incoming.emit("close");
      expect(stream.write).toHaveBeenCalledWith('event: connected\ndata: {"cursor":0}\n\n');
    } finally {
      vi.useRealTimers();
    }
  });
});
