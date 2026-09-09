// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import { GitOperation } from "./git-operation";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  mocks.start.mockReset();
  mocks.status.mockReset();
});
it("pulls the selected branch and refreshes after the import completes", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValueOnce({ status: "running" }).mockResolvedValue({ status: "done" });
  render(<GitOperation projectId="project" branch="docs/update" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith({ projectId: "project", branch: "docs/update" });
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  await act(async () => {
    vi.advanceTimersByTime(2000);
  });
  expect(screen.getByRole("status").textContent).toBe("Изменения получены");
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});
it("creates a review for already committed branch changes", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done" });
  render(<GitOperation projectId="project" branch="docs/update" createReview />);
  fireEvent.change(screen.getByLabelText("Название PR / MR"), {
    target: { value: "Updated guide" },
  });
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith({
    projectId: "project",
    branch: "docs/update",
    title: "Updated guide",
  });
  expect(screen.getByRole("status").textContent).toBe("PR / MR создан");
});
it("shows failed jobs and allows retry", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed" });
  render(<GitOperation projectId="project" branch="docs/update" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(screen.getByRole("alert")).toBeTruthy();
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(false);
});
