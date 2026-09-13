// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  twoFactorStatusAction: vi.fn(),
  criticalSettingsAction: vi.fn(),
}));

import { CopyInvitation } from "./member-actions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
it("copies the exact invitation link and announces success", async () => {
  const copy = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  render(<CopyInvitation value="https://docs.example/invite/one-time-token" />);
  fireEvent.click(screen.getByText("Скопировать ссылку"));
  await screen.findByText("Ссылка скопирована");
  expect(copy).toHaveBeenCalledWith("https://docs.example/invite/one-time-token");
});
it("keeps a manually selectable link when clipboard access fails", async () => {
  vi.stubGlobal("navigator", {
    clipboard: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  render(<CopyInvitation value="https://docs.example/invite/token" />);
  fireEvent.click(screen.getByText("Скопировать ссылку"));
  await screen.findByText(/Не удалось скопировать/);
  expect(screen.getByLabelText("Ссылка приглашения")).toHaveProperty(
    "value",
    "https://docs.example/invite/token",
  );
});

it("shows pending state and allows another copy after success", async () => {
  let resolve: () => void = () => {};
  const copy = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<void>((done) => {
          resolve = done;
        }),
    )
    .mockResolvedValue(undefined);
  vi.stubGlobal("navigator", { clipboard: { writeText: copy } });
  render(<CopyInvitation value="https://docs.example/invite/token" />);
  fireEvent.click(screen.getByText("Скопировать ссылку"));
  expect(screen.getByText("Копируем…")).toHaveProperty("disabled", true);
  resolve();
  await screen.findByText("Ссылка скопирована");
  fireEvent.click(screen.getByText("Скопировано"));
  await screen.findByText("Ссылка скопирована");
  expect(copy).toHaveBeenCalledTimes(2);
});
it("selects the link and reports unavailable clipboard access", async () => {
  vi.stubGlobal("navigator", {});
  render(<CopyInvitation value="https://docs.example/invite/token" />);
  fireEvent.click(screen.getByText("Скопировать ссылку"));
  await screen.findByRole("alert");
  const input = screen.getByLabelText("Ссылка приглашения") as HTMLInputElement;
  expect(document.activeElement).toBe(input);
  expect(input.selectionEnd).toBe(input.value.length);
});

it("offers manual copying when clipboard permission never resolves", async () => {
  vi.useFakeTimers();
  vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>(() => {}) } });
  render(<CopyInvitation value="https://docs.example/invite/token" />);
  fireEvent.click(screen.getByText("Скопировать ссылку"));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(screen.getByRole("alert").textContent).toContain("Ссылка выделена");
  expect(screen.getByText("Скопировать ссылку")).toHaveProperty("disabled", false);
});
