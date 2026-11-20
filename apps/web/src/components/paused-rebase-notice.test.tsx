// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ cancel: vi.fn(), refresh: vi.fn() }));
vi.mock("@/app/conflict-actions", () => ({
  cancelRebaseUpdateAction: mocks.cancel,
  inspectReviewConflictsAction: vi.fn(),
}));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: vi.fn(),
  gitOperationStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { conflictInspectionStore } from "./conflict-inspection";
import { PausedRebaseNotice } from "./paused-rebase-notice";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

function mount(overrides: Partial<Parameters<typeof PausedRebaseNotice>[0]> = {}) {
  return render(
    <PausedRebaseNotice
      projectId="project"
      reviewId="closed-review"
      branch="docs/task"
      operationId="rebase"
      conflictId="current-conflict"
      canResolve={false}
      canWrite
      {...overrides}
    />,
  );
}

it("cancels a paused rebase without loading its MR and prevents repeat clicks while pending", async () => {
  let finish: (() => void) | undefined;
  mocks.cancel.mockImplementation(() => new Promise<void>((resolve) => (finish = resolve)));
  const invalidate = vi.spyOn(conflictInspectionStore, "invalidate");
  mount();
  expect(screen.queryByRole("link", { name: "Исправить конфликты" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Отменить rebase" }));
  const button = screen.getByRole("button", { name: "Отменяем rebase…" });
  expect(button).toHaveProperty("disabled", true);
  fireEvent.click(button);
  expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("project", "rebase", "current-conflict");
  expect(mocks.refresh).not.toHaveBeenCalled();
  await act(async () => finish?.());
  expect(invalidate).toHaveBeenCalledWith("project", "closed-review");
  expect(mocks.refresh).toHaveBeenCalledOnce();
});

it("keeps the existing resolution link for an open MR", () => {
  mount({ canResolve: true });
  expect(screen.getByRole("link", { name: "Исправить конфликты" }).getAttribute("href")).toBe(
    "/projects/project/changes?branch=docs%2Ftask&resolve=closed-review",
  );
  expect(screen.getByRole("button", { name: "Отменить rebase" })).toBeTruthy();
});

it("shows a stale conflict error and allows retry without discarding local work", async () => {
  mocks.cancel.mockRejectedValueOnce(new Error("Конфликтный коммит изменился."));
  localStorage.setItem("unrelated-draft", "Local work");
  mount();
  fireEvent.click(screen.getByRole("button", { name: "Отменить rebase" }));
  await waitFor(() =>
    expect(screen.getByRole("alert").textContent).toBe("Конфликтный коммит изменился."),
  );
  expect(screen.getByRole("button", { name: "Отменить rebase" })).toHaveProperty("disabled", false);
  expect(mocks.refresh).not.toHaveBeenCalled();
  expect(localStorage.getItem("unrelated-draft")).toBe("Local work");
  fireEvent.click(screen.getByRole("button", { name: "Отменить rebase" }));
  await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  localStorage.clear();
});

it("does not offer cancellation or resolution to a reader", () => {
  mount({ canWrite: false, canResolve: true });
  expect(screen.getByRole("button", { name: "Отменить rebase" })).toHaveProperty("disabled", true);
  expect(screen.queryByRole("link")).toBeNull();
  expect(mocks.cancel).not.toHaveBeenCalled();
});
