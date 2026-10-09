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
    status: "queued",
    createdAt: "2026-10-09T10:00:00Z",
    readyAt: null,
    startupMs: 1500,
    expiresAt: null,
    diskBytes: 1048576,
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
  expect(screen.getByText("3 файлов")).toBeTruthy();
  expect(screen.getByText("1 МиБ")).toBeTruthy();
  expect(screen.getByText("1,5 с")).toBeTruthy();
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
  vi.spyOn(window, "confirm").mockReturnValue(true);
  render(<PreviewList projectId="project" canDelete />);
  fireEvent.click(await screen.findByRole("button", { name: "Удалить" }));
  await waitFor(() => expect(screen.getByText("Удаляется")).toBeTruthy());
  expect(fetcher).toHaveBeenCalledWith(
    "/api/projects/project/previews",
    expect.objectContaining({ method: "DELETE", body: JSON.stringify({ branch: "feature/docs" }) }),
  );
});
