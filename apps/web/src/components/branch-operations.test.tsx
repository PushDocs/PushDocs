// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ start: vi.fn(), status: vi.fn() }));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));

import { BranchOperations } from "./branch-operations";
import { gitOperationStore } from "./git-operation-store";

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
  gitOperationStore.clear();
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

it("restores an operation when navigating away before the start request returns", async () => {
  let started: ((id: string) => void) | undefined;
  mocks.start.mockReturnValue(new Promise<string>((resolve) => (started = resolve)));
  mocks.status.mockResolvedValue({ status: "running" });
  const first = mount({ branch: "stable" });
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  first.unmount();

  const onBusyChange = vi.fn();
  const next = mount({ branch: "stable", onBusyChange });
  expect(screen.getByRole("button", { name: "Обновляем ветку…" }).hasAttribute("disabled")).toBe(
    true,
  );
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  await act(async () => started?.("original-job"));
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.status).toHaveBeenCalledWith("project", "original-job");
  expect(first.props.onComplete).not.toHaveBeenCalled();
  expect(next.props.onComplete).not.toHaveBeenCalled();
});

it("reloads documents after a merge finishes while away and keeps editing locked until reload", async () => {
  let finish: ((job: { status: string }) => void) | undefined;
  let reload: (() => void) | undefined;
  mocks.start.mockResolvedValue("merge-job");
  mocks.status.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
  const first = mount();
  fireEvent.click(screen.getByText("Влить stable…"));
  fireEvent.click(screen.getByRole("button", { name: "Влить в docs/task" }));
  await act(async () => {});
  first.unmount();
  await act(async () => finish?.({ status: "done" }));
  expect(first.props.onComplete).not.toHaveBeenCalled();

  const onBusyChange = vi.fn();
  const next = mount({
    onBusyChange,
    onComplete: vi.fn(() => new Promise<void>((resolve) => (reload = resolve))),
  });
  await act(async () => {});
  expect(next.props.onComplete).toHaveBeenCalledOnce();
  expect(onBusyChange).toHaveBeenLastCalledWith(true);
  expect(screen.getByRole("button", { name: "Обновляем ветку…" }).hasAttribute("disabled")).toBe(
    true,
  );
  await act(async () => reload?.());
  expect(onBusyChange).toHaveBeenLastCalledWith(false);
  expect(screen.getByRole("status").textContent).toContain("stable влита в docs/task");
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("keeps operations scoped to their project and branch", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  const first = mount({ branch: "stable" });
  fireEvent.click(screen.getByRole("button", { name: "Обновить из Git" }));
  await act(async () => {});
  first.unmount();
  const otherBranch = mount({ branch: "other", canMerge: false });
  expect(screen.getByRole("button", { name: "Обновить из Git" }).hasAttribute("disabled")).toBe(
    false,
  );
  otherBranch.unmount();
  mount({ projectId: "other-project", branch: "stable" });
  expect(screen.getByRole("button", { name: "Обновить из Git" }).hasAttribute("disabled")).toBe(
    false,
  );
  expect(mocks.start).toHaveBeenCalledOnce();
});
