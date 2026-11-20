// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  start: vi.fn(),
  status: vi.fn(),
  refresh: vi.fn(),
  freshness: vi.fn(),
  check: vi.fn(),
}));
vi.mock("./use-branch-freshness", () => ({ useBranchFreshness: mocks.freshness }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
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
beforeEach(() => {
  mocks.freshness.mockReturnValue({
    filesCurrent: false,
    includesDefaultBranch: false,
    checking: false,
    refresh: mocks.check,
  });
});
afterEach(() => {
  cleanup();
  gitOperationStore.clear();
  vi.useRealTimers();
  vi.resetAllMocks();
});

it("replaces unnecessary actions with the current branch status", async () => {
  mocks.freshness.mockReturnValue({ filesCurrent: true, includesDefaultBranch: true });
  const { props, rerender } = mount({ headSha: "current", remoteHeadSha: "current" });
  expect(screen.getByRole("status").textContent).toBe("Ветка актуальна");
  expect(screen.queryByRole("button")).toBeNull();
  expect(screen.queryByText("Обновить ветку…")).toBeNull();
  expect(props.beforeStart).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
  mocks.freshness.mockReturnValue({ filesCurrent: false, includesDefaultBranch: true });
  rerender(<BranchOperations {...props} remoteHeadSha="next" />);
  expect(screen.getByRole("button", { name: "Обновить файлы" })).toHaveProperty("disabled", false);
  expect(screen.queryByText("Обновить ветку…")).toBeNull();
});

it("shows only the update needed from stable when imported files are current", () => {
  mocks.freshness.mockReturnValue({ filesCurrent: true, includesDefaultBranch: false });
  mount();
  expect(screen.queryByRole("button", { name: "Обновить файлы" })).toBeNull();
  expect(screen.getByText("Обновить ветку…")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

it("uses an icon to check unknown freshness without starting a Git operation", () => {
  mocks.freshness.mockReturnValue({
    filesCurrent: null,
    includesDefaultBranch: null,
    checking: false,
    refresh: mocks.check,
  });
  mount();
  const check = screen.getByRole("button", { name: "Проверить обновления" });
  expect(check.textContent).toBe("");
  expect(screen.queryByText("Обновить ветку…")).toBeNull();
  expect(screen.queryByRole("button", { name: "Обновить файлы" })).toBeNull();
  fireEvent.click(check);
  expect(mocks.check).toHaveBeenCalledOnce();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("saves first, imports the selected branch and reloads documents after completion", async () => {
  vi.useFakeTimers();
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValueOnce({ status: "running" }).mockResolvedValue({ status: "done" });
  const { props } = mount({ branch: "stable" });
  expect(screen.queryByText("Обновить ветку…")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Обновить файлы" }));
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

it("briefly explains the branch update and push before confirmation", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "done" });
  mount();
  fireEvent.click(screen.getByText("Обновить ветку…"));
  expect(screen.getByText(/Добавит изменения из stable и отправит ветку в Git/)).toBeTruthy();
  expect(mocks.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledWith({
    projectId: "project",
    branch: "docs/task",
    mergeDefault: true,
  });
  expect(screen.getByRole("status").textContent).toBe("Ветка docs/task обновлена из stable");
});

it("does not start if saving fails and hides merging for readers and protected branches", async () => {
  mount({ canMerge: false, beforeStart: vi.fn().mockResolvedValue(false) });
  expect(screen.queryByText("Обновить ветку…")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  await act(async () => {});
  expect(mocks.start).not.toHaveBeenCalled();
  expect(screen.getByRole("alert").textContent).toContain("Сначала сохраните");
});

it("shows merge conflicts without claiming success and keeps the operation retryable", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "failed", last_error: "Конфликт в Git" });
  const { props } = mount();
  fireEvent.click(screen.getByText("Обновить ветку…"));
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toBe("Конфликт в Git");
  expect(props.onComplete).not.toHaveBeenCalled();
  expect(screen.getByRole("button", { name: "Обновить файлы" }).hasAttribute("disabled")).toBe(
    false,
  );
});

it("refreshes the existing sidebar and Changes notice when an update pauses on conflicts", async () => {
  mocks.start.mockResolvedValue("operation");
  mocks.status.mockResolvedValue({ status: "needs_resolution" });
  const { props } = mount();
  fireEvent.click(screen.getByText("Обновить ветку…"));
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(props.onComplete).toHaveBeenCalledOnce();
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByText("Ветка docs/task обновлена из stable")).toBeNull();
});

it("retries status reads after connection loss and reports document reload failures accurately", async () => {
  vi.useFakeTimers();
  mocks.start.mockRejectedValueOnce(new Error("offline")).mockResolvedValue("job");
  mocks.status.mockRejectedValueOnce(new Error("offline")).mockResolvedValue({ status: "done" });
  mount({ onComplete: vi.fn().mockRejectedValue(new Error("offline")) });
  fireEvent.click(screen.getByRole("button", { name: "Обновить файлы" }));
  await act(async () => {});
  expect(screen.getByRole("alert").textContent).toContain("Не удалось начать");
  fireEvent.click(screen.getByRole("button", { name: "Обновить файлы" }));
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
  fireEvent.click(screen.getByRole("button", { name: "Обновить файлы" }));
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
  fireEvent.click(screen.getByText("Обновить ветку…"));
  fireEvent.click(screen.getByRole("button", { name: "Обновить ветку" }));
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
  expect(screen.getByRole("status").textContent).toContain("Ветка docs/task обновлена из stable");
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("keeps operations scoped to their project and branch", async () => {
  mocks.start.mockResolvedValue("job");
  mocks.status.mockResolvedValue({ status: "running" });
  const first = mount({ branch: "stable" });
  fireEvent.click(screen.getByRole("button", { name: "Обновить файлы" }));
  await act(async () => {});
  first.unmount();
  const otherBranch = mount({ branch: "other", canMerge: false });
  expect(screen.getByRole("button", { name: "Обновить файлы" }).hasAttribute("disabled")).toBe(
    false,
  );
  otherBranch.unmount();
  mount({ projectId: "other-project", branch: "stable" });
  expect(screen.getByRole("button", { name: "Обновить файлы" }).hasAttribute("disabled")).toBe(
    false,
  );
  expect(mocks.start).toHaveBeenCalledOnce();
});
