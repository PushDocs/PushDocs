// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import { GitOperation, SubmissionRefresh } from "./git-operation";

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

it("reports start and polling failures and retries the status check", async () => {
  vi.useFakeTimers();
  mocks.start.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("job");
  mocks.status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "done" });
  render(<GitOperation projectId="project" branch="main" reviewsOnly reviewLabel="MR" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Не удалось начать");
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(screen.getByRole("status").textContent).toContain("Нет связи");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByRole("status").textContent).toBe("Состояние MR обновлено");
});

it("refreshes active submissions on a timer and when connectivity returns", () => {
  vi.useFakeTimers();
  const view = render(<SubmissionRefresh active={false} />);
  window.dispatchEvent(new Event("online"));
  expect(mocks.router.refresh).not.toHaveBeenCalled();
  view.rerender(<SubmissionRefresh active />);
  window.dispatchEvent(new Event("online"));
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
  act(() => vi.advanceTimersByTime(30_000));
  expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
  view.unmount();
  window.dispatchEvent(new Event("online"));
  expect(mocks.router.refresh).toHaveBeenCalledTimes(2);
});

it("ignores late polling results and failures after unmount", async () => {
  let resolve: ((value: { status: "done" }) => void) | undefined;
  mocks.start.mockResolvedValue("job");
  mocks.status.mockReturnValueOnce(new Promise((done) => (resolve = done)));
  const view = render(<GitOperation projectId="project" branch="main" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  view.unmount();
  await act(async () => resolve?.({ status: "done" }));
  expect(mocks.router.refresh).not.toHaveBeenCalled();

  let reject: ((error: Error) => void) | undefined;
  mocks.status.mockReturnValueOnce(new Promise((_done, fail) => (reject = fail)));
  const failed = render(<GitOperation projectId="project" branch="main" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  failed.unmount();
  await act(async () => reject?.(new Error("late")));
});
