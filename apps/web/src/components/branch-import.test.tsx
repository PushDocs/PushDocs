// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  status: vi.fn(),
  sync: vi.fn(),
  router: { refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/actions", () => ({
  gitOperationStatusAction: mocks.status,
  synchronizeBranchAction: mocks.sync,
}));

import { BranchImport } from "./branch-import";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.router.refresh.mockReset();
  mocks.status.mockReset();
  mocks.sync.mockReset();
});
it("polls the job without refreshing the route, then refreshes once when loading finishes", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status
    .mockResolvedValueOnce({ status: "queued" })
    .mockResolvedValueOnce({ status: "done" });
  const view = render(
    <StrictMode>
      <BranchImport projectId="project" branch="docs/fix #1" />
    </StrictMode>,
  );
  await act(async () => {});
  expect(mocks.sync).toHaveBeenCalledTimes(1);
  expect(Object.fromEntries(mocks.sync.mock.calls[0]?.[0] ?? [])).toEqual({
    projectId: "project",
    branch: "docs/fix #1",
  });
  expect(screen.getByRole("status").textContent).toContain("Загружаем");
  const progress = screen.getByRole("progressbar", { name: "Загрузка файлов ветки" });
  expect(progress.hasAttribute("aria-valuenow")).toBe(false);
  expect(mocks.status).toHaveBeenCalledWith("project", "job");
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("progressbar")).toBe(progress);
  view.unmount();
  expect(screen.queryByRole("progressbar")).toBeNull();
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});
it("offers a retry on failure and starts loading again", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "queued" });
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  expect(screen.queryByRole("progressbar")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await act(async () => {});
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.getByRole("progressbar", { name: "Загрузка файлов ветки" })).toBeTruthy();
});
it("stops polling and offers a retry when loading times out", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "queued" });
  render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  await act(async () => {
    vi.advanceTimersByTime(300_000);
  });
  expect(screen.getByRole("alert").textContent).toContain("ещё не загрузилась");
  expect(screen.queryByRole("progressbar")).toBeNull();
  const count = mocks.status.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(mocks.status).toHaveBeenCalledTimes(count);
  expect(mocks.router.refresh).not.toHaveBeenCalled();
});
