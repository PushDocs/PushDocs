// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ sync: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));
vi.mock("@/app/actions", () => ({ synchronizeBranchAction: mocks.sync }));

import { BranchImport } from "./branch-import";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.sync.mockReset();
});
it("loads the requested branch once in Strict Mode and polls until the editor replaces it", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue(undefined);
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
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
});
it("offers a retry on failure and starts loading again", async () => {
  mocks.sync.mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
  render(<BranchImport projectId="project" branch="docs/update" />);
  expect(await screen.findByRole("alert")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Повторить загрузку" }));
  await act(async () => {});
  expect(mocks.sync).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("alert")).toBeNull();
});
it("stops polling and offers a retry when loading times out", async () => {
  vi.useFakeTimers();
  mocks.sync.mockResolvedValue(undefined);
  render(<BranchImport projectId="project" branch="docs/update" />);
  await act(async () => {});
  await act(async () => {
    vi.advanceTimersByTime(300_000);
  });
  expect(screen.getByRole("alert").textContent).toContain("ещё не загрузилась");
  const count = mocks.router.refresh.mock.calls.length;
  await act(async () => {
    vi.advanceTimersByTime(4000);
  });
  expect(mocks.router.refresh).toHaveBeenCalledTimes(count);
});
