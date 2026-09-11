// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspect: vi.fn(),
  status: vi.fn().mockResolvedValue(false),
  save: vi.fn(),
}));
vi.mock("@/app/actions", () => ({
  inspectProjectRepository: mocks.inspect,
  twoFactorStatusAction: mocks.status,
  criticalSettingsAction: mocks.save,
}));

import { ProjectImportForm } from "./project-import-form";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
function renderForm() {
  render(<ProjectImportForm connections={[{ id: "c", name: "Sendsay", kind: "gitlab" }]} />);
}
it("checks the repository before exposing import settings, fills defaults, preserves locator on back", async () => {
  mocks.inspect.mockResolvedValue({
    id: "42",
    name: "Sendsay Docs",
    defaultBranch: "stable",
    branches: ["stable", "work"],
    roots: ["."],
  });
  renderForm();
  expect(screen.queryByLabelText("Короткий адрес")).toBeNull();
  fireEvent.change(screen.getByLabelText("Адрес репозитория"), {
    target: { value: "https://git.example/docs" },
  });
  fireEvent.click(screen.getByText("Проверить и продолжить"));
  expect(await screen.findByLabelText("Название")).toHaveProperty("value", "Sendsay Docs");
  expect(screen.getByLabelText("Короткий адрес")).toHaveProperty("value", "sendsay-docs");
  expect(mocks.inspect).toHaveBeenCalledWith({
    connectionId: "c",
    locator: "https://git.example/docs",
  });
  await screen.findByRole("link", { name: "Настроить в профиле" });
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Другой репозиторий"));
  expect(screen.getByLabelText("Адрес репозитория")).toHaveProperty(
    "value",
    "https://git.example/docs",
  );
});
it("keeps the form usable when checking access fails", async () => {
  mocks.inspect.mockRejectedValue(new Error("offline"));
  renderForm();
  fireEvent.change(screen.getByLabelText("Адрес репозитория"), { target: { value: "bad" } });
  fireEvent.click(screen.getByText("Проверить и продолжить"));
  await screen.findByRole("alert");
  await waitFor(() =>
    expect(screen.getByText("Проверить и продолжить").closest("fieldset")?.disabled).toBe(false),
  );
  expect(screen.queryByLabelText("Короткий адрес")).toBeNull();
});
