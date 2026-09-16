// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { LivePreviewButton } from "./live-preview-button";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it("acquires a preview on mount, opens it in a new tab and releases it on unmount", async () => {
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

  const view = render(<LivePreviewButton projectId="project" branch="docs/update" />);
  const link = await screen.findByRole("link", { name: "Предпросмотр" });
  expect(link.getAttribute("href")).toBe("http://213.148.1.118:43000/");
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

  render(<LivePreviewButton projectId="project" branch="docs/update" />);
  expect(
    await screen.findByText(
      "Устанавливаем зависимости. Первый запуск может занять несколько минут.",
    ),
  ).toBeTruthy();
});
