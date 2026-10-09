// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LivePreviewButton } from "./live-preview-button";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("keeps a capacity queue visible without reporting the runner as broken after 30 seconds", async () => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        sessionId: "00000000-0000-4000-8000-000000000001",
        status: "queued",
        waitingForCapacity: true,
        message: "Ожидаем свободное место для предпросмотра.",
      }),
    ),
  );
  render(<LivePreviewButton projectId="project" branch="stable" autoStart />);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(32_000);
  });
  expect(
    screen.getByRole("button", { name: "Предпросмотр ветки stable запускается" }).textContent,
  ).toContain("очередь");
  expect(screen.queryByRole("alert")).toBeNull();
});

it("acquires a preview on an explicit viewer visit and releases it on unmount", async () => {
  const requests: Array<{ action: string; keepalive?: boolean }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "{}")) as { action?: string };
      requests.push({ action: body.action ?? "status", keepalive: init?.keepalive });
      return new Response(
        JSON.stringify({
          sessionId: "00000000-0000-4000-8000-000000000001",
          status: "ready",
          url: "http://213.148.1.118:43000/",
        }),
        { headers: { "Content-Type": "application/json" } },
      );
    }),
  );

  const view = render(<LivePreviewButton projectId="project" branch="docs/update" autoStart />);
  const link = await screen.findByRole("link", { name: "Открыть предпросмотр" });
  expect(link.getAttribute("href")).toBe("/projects/project/previews/view?branch=docs%2Fupdate");
  expect(link.getAttribute("target")).toBe("_blank");

  view.unmount();
  await waitFor(() => expect(requests.some((request) => request.action === "release")).toBe(true));
  expect(requests.at(-1)).toEqual({ action: "release", keepalive: true });
});

it("shows the current startup stage instead of an indefinite spinner", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            sessionId: "00000000-0000-4000-8000-000000000001",
            status: "starting",
            message: "Устанавливаем зависимости. Первый запуск может занять несколько минут.",
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    ),
  );

  render(<LivePreviewButton projectId="project" branch="docs/update" autoStart />);
  expect(
    await screen.findByText(
      "Устанавливаем зависимости. Первый запуск может занять несколько минут.",
    ),
  ).toBeTruthy();
});

it("shows the preview startup failure in a visible dismissible alert", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        sessionId: "00000000-0000-4000-8000-000000000001",
        status: "failed",
        error: "git fetch: early EOF",
      }),
    ),
  );

  render(<LivePreviewButton projectId="project" branch="stable" autoStart />);
  expect((await screen.findByRole("alert")).textContent).toContain("git fetch: early EOF");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть уведомление" }));
  expect(screen.queryByRole("alert")).toBeNull();
});

it("reacquires the preview when a deployment expires the tab lease", async () => {
  let acquisitions = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const action = init?.body
        ? (JSON.parse(String(init.body)) as { action: string }).action
        : "status";
      if (action === "acquire") acquisitions++;
      return Response.json({
        sessionId: "00000000-0000-4000-8000-000000000001",
        status: action === "status" ? "stopped" : "queued",
      });
    }),
  );

  render(<LivePreviewButton projectId="project" branch="stable" autoStart />);
  await waitFor(() => expect(acquisitions).toBeGreaterThanOrEqual(2), { timeout: 3000 });
});

it("does not acquire previews on document visits or branch changes until the user clicks start", async () => {
  const commands: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(String(init.body)).action : "status";
      commands.push(action);
      return Response.json({
        status: action === "acquire" ? "starting" : "stopped",
        sessionId: action === "acquire" ? "session" : undefined,
      });
    }),
  );
  const view = render(<LivePreviewButton projectId="project" branch="first" />);
  await screen.findByRole("button", { name: "Запустить предпросмотр ветки first" });
  view.rerender(<LivePreviewButton projectId="project" branch="second" />);
  await screen.findByRole("button", { name: "Запустить предпросмотр ветки second" });
  expect(commands.filter((action) => action === "acquire")).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Запустить предпросмотр ветки second" }));
  await waitFor(() => expect(commands).toContain("acquire"));
});

it("does not reacquire a preview that another user explicitly stopped", async () => {
  let acquired = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const action = init?.body ? JSON.parse(String(init.body)).action : "status";
      if (action === "acquire") acquired++;
      return Response.json({
        sessionId: "session",
        status: action === "acquire" ? "ready" : "stopped",
        url: "http://preview.test/",
        manuallyStopped: action === "status",
      });
    }),
  );
  render(<LivePreviewButton projectId="project" branch="stable" autoStart />);
  await screen.findByRole("link", { name: "Открыть предпросмотр" });
  await screen.findByRole(
    "button",
    { name: "Запустить предпросмотр ветки stable" },
    { timeout: 3000 },
  );
  expect(acquired).toBe(1);
});

it("checks freshness again on opening and refuses to navigate to an outdated site", async () => {
  let reads = 0;
  const replace = vi.fn();
  const close = vi.fn();
  vi.spyOn(window, "open").mockReturnValue({ location: { replace }, close } as unknown as Window);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      if (!init?.method) reads++;
      return Response.json({
        sessionId: "session",
        status: reads > 0 ? "starting" : "ready",
        url: reads > 0 ? undefined : "http://preview.test/",
      });
    }),
  );
  render(<LivePreviewButton projectId="project" branch="stable" autoStart />);
  fireEvent.click(await screen.findByRole("link", { name: "Открыть предпросмотр" }));
  await waitFor(() => expect(close).toHaveBeenCalled());
  expect(replace).not.toHaveBeenCalled();
});
