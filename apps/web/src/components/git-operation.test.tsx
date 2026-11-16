// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn(), router: { refresh: vi.fn() } }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => mocks.router }));

import { BranchOperations } from "./branch-operations";
import { GitOperation, SubmissionRefresh } from "./git-operation";
import { gitOperationStore } from "./git-operation-store";

afterEach(() => {
  cleanup();
  gitOperationStore.clear();
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
  expect(screen.getByRole("status").textContent).toBe("Ветка docs/update обновлена из Git");
  expect(mocks.router.refresh).toHaveBeenCalledTimes(1);
});
it.each(["", "Тикет: https://tracker.test/DOC-123\nКомментарий к изменениям"])(
  "creates a review for already committed branch changes with description %j",
  async (description) => {
    mocks.start.mockResolvedValue("job");
    mocks.status.mockResolvedValue({ status: "done" });
    render(<GitOperation projectId="project" branch="docs/update" createReview />);
    fireEvent.change(screen.getByLabelText("Название PR / MR"), {
      target: { value: "Updated guide" },
    });
    const field = screen.getByRole("textbox", { name: "Описание PR / MR (необязательно)" });
    expect(field).toHaveProperty("required", false);
    fireEvent.change(field, { target: { value: description } });
    fireEvent.click(screen.getByRole("button", { name: "Создать PR / MR" }));
    await act(async () => {});
    expect(mocks.start).toHaveBeenCalledWith({
      projectId: "project",
      branch: "docs/update",
      title: "Updated guide",
      description,
    });
    expect(screen.getByRole("status").textContent).toBe("PR / MR создан");
  },
);
it("includes an inserted Markdown link when creating a review", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  render(<GitOperation projectId="project" branch="docs/update" createReview />);
  fireEvent.change(screen.getByLabelText("Название PR / MR"), {
    target: { value: "Updated guide" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Добавить ссылку" }));
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Создать PR / MR" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith({
    projectId: "project",
    branch: "docs/update",
    title: "Updated guide",
    description: "[Текст]()",
  });
  expect(screen.getByRole("button", { name: "Добавить ссылку" })).toHaveProperty("disabled", true);
});
it("shows failed jobs and allows retry", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed", last_error: "Ветка не содержит изменений" });
  render(<GitOperation projectId="project" branch="docs/update" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toBe("Ветка не содержит изменений");
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
  const failed = render(<GitOperation projectId="project" branch="other" />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  failed.unmount();
  await act(async () => reject?.(new Error("late")));
});

it("resumes MR refresh after navigation without starting another job", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("reviews-job");
  mocks.status.mockResolvedValue({ status: "running" });
  const first = render(
    <GitOperation projectId="project" branch="main" reviewsOnly reviewLabel="MR" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Обновить данные MR" }));
  await act(async () => {});
  first.unmount();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(mocks.status).toHaveBeenCalledOnce();

  mocks.status.mockResolvedValueOnce({ status: "done" });
  render(<GitOperation projectId="project" branch="stable" reviewsOnly reviewLabel="MR" />);
  expect(screen.getByRole("button", { name: "Обновляем MR…" }).hasAttribute("disabled")).toBe(true);
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.status).toHaveBeenLastCalledWith("project", "reviews-job");
  expect(mocks.router.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole("status").textContent).toBe("Состояние MR обновлено");
});

it("shares branch refresh state between Documents and Changes", async () => {
  mocks.start.mockResolvedValue("branch-job");
  mocks.status.mockResolvedValue({ status: "running" });
  const first = render(<GitOperation projectId="project" branch="stable" />);
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  first.unmount();
  const onBusyChange = vi.fn();
  render(
    <BranchOperations
      projectId="project"
      branch="stable"
      canMerge={false}
      disabled={false}
      beforeStart={vi.fn()}
      onComplete={vi.fn()}
      onBusyChange={onBusyChange}
    />,
  );
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: "Обновляем ветку…" }).hasAttribute("disabled")).toBe(
    true,
  );
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.status).toHaveBeenLastCalledWith("project", "branch-job");
});

it("does not confuse MR refresh with a branch named reviews", async () => {
  mocks.start.mockResolvedValue("reviews-job");
  mocks.status.mockResolvedValue({ status: "running" });
  const first = render(<GitOperation projectId="project" branch="main" reviewsOnly />);
  fireEvent.click(screen.getByRole("button", { name: "Обновить данные PR / MR" }));
  await act(async () => {});
  first.unmount();
  render(<GitOperation projectId="project" branch="reviews" />);
  expect(screen.getByRole("button", { name: "Обновить из Git" })).toHaveProperty("disabled", false);
});

it("uses one poller and rejects duplicate submits while a start request is pending", async () => {
  let started: ((id: string) => void) | undefined;
  mocks.start.mockReturnValue(new Promise<string>((resolve) => (started = resolve)));
  mocks.status.mockResolvedValue({ status: "running" });
  const view = render(
    <>
      <GitOperation projectId="project" branch="main" reviewsOnly />
      <GitOperation projectId="project" branch="main" reviewsOnly />
    </>,
  );
  const forms = view.container.querySelectorAll("form");
  fireEvent.submit(forms[0] as HTMLFormElement);
  fireEvent.submit(forms[1] as HTMLFormElement);
  expect(mocks.start).toHaveBeenCalledOnce();
  await act(async () => started?.("job"));
  expect(mocks.status).toHaveBeenCalledOnce();
});

it("reuses an in-flight status request when returning to the operation", async () => {
  vi.useFakeTimers();
  let finish: ((job: { status: string }) => void) | undefined;
  mocks.start.mockResolvedValue("job");
  mocks.status
    .mockReturnValueOnce(new Promise((resolve) => (finish = resolve)))
    .mockResolvedValue({ status: "done" });
  const view = render(<GitOperation projectId="project" branch="main" reviewsOnly />);
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  view.unmount();
  render(<GitOperation projectId="project" branch="stable" reviewsOnly />);
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  expect(mocks.status).toHaveBeenCalledTimes(1);
  await act(async () => finish?.({ status: "running" }));
  await act(async () => vi.advanceTimersByTimeAsync(2000));
  expect(mocks.start).toHaveBeenCalledTimes(1);
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(screen.getByRole("status").textContent).toBe("Состояние PR / MR обновлено");
});
