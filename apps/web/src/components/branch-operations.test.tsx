// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn() }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));

import { BranchOperations } from "./branch-operations";

function mount(overrides: Partial<Parameters<typeof BranchOperations>[0]> = {}) {
  const props = {
    projectId: "project",
    branch: "docs/task",
    defaultBranch: "stable",
    canMerge: true,
    disabled: false,
    beforeStart: vi.fn().mockResolvedValue(true),
    onComplete: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
  return { ...render(<BranchOperations {...props} />), props };
}
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("saves first, imports the selected branch and reloads documents after completion", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValueOnce({ status: "running" }).mockResolvedValue({ status: "done" });
  const { props } = mount({ branch: "stable" });
  expect(screen.queryByText("Влить stable…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  expect(vi.mocked(props.beforeStart).mock.invocationCallOrder[0]).toBeLessThan(
    mocks.start.mock.invocationCallOrder[0] ?? 0,
  );
  expect(mocks.start).toHaveBeenCalledWith({ projectId: "project", branch: "stable" });
  expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(2000);
  });
  expect(props.onComplete).toHaveBeenCalledOnce();
  expect(screen.getByRole("status").textContent).toContain("stable обновлена");
});

it("explains the push before merging without requiring or creating a review", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done" });
  mount();
  fireEvent.click(screen.getByText("Влить stable…"));
  expect(screen.getByText(/PR \/ MR не требуется/)).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Влить в docs/task" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith({
    projectId: "project",
    branch: "docs/task",
    mergeDefault: true,
  });
  expect(screen.getByRole("status").textContent).toBe("stable влита в docs/task");
});

it("does not start if saving fails and hides merging for readers and protected branches", async () => {
  mount({ canMerge: false, beforeStart: vi.fn().mockResolvedValue(false) });
  expect(screen.queryByText("Влить stable…")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(mocks.start).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Сначала сохраните");
});

it("shows merge conflicts without claiming success and keeps the operation retryable", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed", last_error: "Конфликт в Git" });
  const { props } = mount();
  fireEvent.click(screen.getByText("Влить stable…"));
  fireEvent.click(screen.getByRole("button", { name: "Влить в docs/task" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toBe("Конфликт в Git");
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Обновить из Git" }).hasAttribute("disabled")).toBe(
    false,
  );
});

it("retries status reads after connection loss and reports document reload failures accurately", async () => {
  vi.useFakeTimers();
  mocks.start.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("job");
  mocks.status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "done" });
  mount({ onComplete: vi.fn().mockRejectedValue(new Error("offline")) });
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Не удалось начать");
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  expect(screen.getByRole("status").textContent).toContain("Нет связи");
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Операция в Git завершена");
});
