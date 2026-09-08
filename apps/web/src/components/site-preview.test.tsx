// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SitePreview } from "./site-preview";

vi.mock("next/link", () => ({ default: (props: Record<string, unknown>) => <a {...props} /> }));
beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json({ configured: true, builds: [] })),
  );
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
async function mount(canBuild = true) {
  await act(async () => {
    render(<SitePreview projectId="p" branch="docs/new" revision={7} canBuild={canBuild} />);
  });
}
it("explains an unconfigured runner and disables builds", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ configured: false, builds: [] }));
  await mount();
  expect(screen.getByText(/Оператор ещё не настроил runner/)).toBeTruthy();
  expect(screen.getByRole("button")).toHaveProperty("disabled", true);
});
it("builds the frozen draft revision and polls status", async () => {
  await mount();
  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  expect(fetch).toHaveBeenCalledWith(
    "/api/projects/p/preview",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ branch: "docs/new", revision: 7 }),
    }),
  );
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(fetch).toHaveBeenCalledTimes(4);
});
it("coalesces saved revisions for opt-in rebuilds and uses the latest server revision", async () => {
  let revision = 8;
  vi.mocked(fetch).mockImplementation(async (_url, options) =>
    options?.method === "POST"
      ? Response.json({ id: "build" })
      : Response.json({
          configured: true,
          revision,
          sha: "new-head",
          changeStatus: "open",
          builds: [],
        }),
  );
  await mount();
  fireEvent.click(screen.getByLabelText("Обновлять после сохранения"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(3000);
  });
  revision = 9;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(8000);
  });
  const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(posts[0]?.[1]?.body).toBe(JSON.stringify({ branch: "docs/new", revision: 9 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(20000);
  });
  expect(
    vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST"),
  ).toHaveLength(1);
});
it("retains an old successful preview while another build runs", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      configured: true,
      builds: [
        {
          id: "2",
          sha: "123456789",
          revision: 8,
          status: "building",
          log: "Installing",
          stale: false,
          url: null,
        },
        {
          id: "1",
          sha: "123456789",
          revision: 7,
          status: "ready",
          log: "Built",
          stale: true,
          url: "https://example.test",
        },
      ],
    }),
  );
  await mount();
  expect(screen.getByText("Готово (снимок устарел)")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Открыть сайт" }).getAttribute("href")).toBe(
    "https://example.test",
  );
  expect(screen.getByRole("button")).toHaveProperty("disabled", true);
});
it("shows server and network errors without losing the screen", async () => {
  await mount();
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({ error: "Новая ревизия" }, { status: 409 }),
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button"));
  });
  expect(screen.getByRole("alert").textContent).toContain("Новая ревизия");
  vi.mocked(fetch).mockResolvedValueOnce(Response.json({ error: "Не доступно" }, { status: 403 }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Не доступно");
});
it("does not grant build permission to a reader", async () => {
  await mount(false);
  expect(screen.getByRole("button")).toHaveProperty("disabled", true);
});

it("shows queued, failed and unfamiliar build states without hiding empty logs", async () => {
  vi.mocked(fetch).mockResolvedValueOnce(
    Response.json({
      configured: true,
      builds: ["queued", "failed", "cancelled"].map((status) => ({
        id: status,
        status,
        sha: "12345678",
        revision: 0,
        log: "",
        stale: false,
        url: null,
      })),
    }),
  );
  await mount();
  expect(screen.getByText("В очереди")).toBeTruthy();
  expect(screen.getByText("Ошибка сборки")).toBeTruthy();
  expect(screen.getByText("cancelled")).toBeTruthy();
  expect(screen.getAllByText("Ожидаем runner…")).toHaveLength(3);
});
