// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const push = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { PreviewList } from "./preview-list";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const previews = [
  {
    branch: "feature/docs",
    isDefault: false,
    status: "queued",
    createdAt: "2026-10-09T10:00:00Z",
    readyAt: null,
    startupMs: 90_000,
    expiresAt: null,
    diskBytes: 1_250_000_000,
    changedFiles: 3,
    url: "http://preview.test:43000/",
    error: null,
  },
];
it("lets readers open queued previews and switch to their branch with complete metadata", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ previews })),
  );
  render(<PreviewList projectId="project" canDelete={false} />);
  await screen.findByText("В очереди");
  fireEvent.click(screen.getByRole("button", { name: "feature/docs" }));
  expect(screen.getByText("3 файлов")).toBeTruthy();
  expect(screen.getByText("1,3 ГБ")).toBeTruthy();
  expect(screen.getByText("1,5 мин")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Открыть предпросмотр" }).getAttribute("href")).toContain(
    "branch=feature%2Fdocs",
  );
  expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Переключиться на ветку" }));
  expect(push).toHaveBeenCalledWith("/projects/project/documents?branch=feature%2Fdocs");
  expect(sessionStorage.getItem("pushdocs:branch:project")).toBe("feature/docs");
});
it("shows deletion progress after the administrator deletes a preview", async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(options?.method === "DELETE" ? { status: "deleting" } : { previews }),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PreviewList projectId="project" canDelete />);
  fireEvent.click(await screen.findByRole("button", { name: "feature/docs" }));
  fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
  expect(fetcher).not.toHaveBeenCalledWith(
    expect.anything(),
    expect.objectContaining({ method: "DELETE" }),
  );
  expect(screen.getByRole("dialog", { name: "Удалить предпросмотр?" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Удалить предпросмотр" }));
  await waitFor(() => expect(screen.getByText("В процессе удаления")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/projects/project/previews",
    expect.objectContaining({ method: "DELETE", body: JSON.stringify({ branch: "feature/docs" }) }),
  );
});

it("keeps the default preview expanded and protected and offers stop for running previews", async () => {
  const fetcher = vi.fn(async (_url: string, options?: RequestInit) =>
    Response.json(
      options?.method === "POST"
        ? { status: "stopping" }
        : {
            previews: [
              { ...previews[0], branch: "main", isDefault: true, status: "ready", diskBytes: null },
            ],
          },
    ),
  );
  vi.stubGlobal("fetch", fetcher);
  render(<PreviewList projectId="project" canDelete />);
  await screen.findByText("Запущен");
  expect(screen.queryByRole("button", { name: "main" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Удалить" })).toBeNull();
  expect(screen.getByText("Не удаляется")).toBeTruthy();
  expect(screen.getByRole("status", { name: "Размер на диске загружается" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Остановить" }));
  await waitFor(() => expect(screen.getByText("Останавливается")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/projects/project/previews",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ branch: "main", action: "stop" }),
    }),
  );
});
