// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { CopyTwoFactorSecret } from "./copy-two-factor-secret";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("copies the setup key and confirms the result", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  render(<CopyTwoFactorSecret value="AAAA BBBB CCCC" />);

  fireEvent.click(screen.getByRole("button", { name: "Копировать" }));

  expect(await screen.findByRole("button", { name: "Скопировано" })).toBeTruthy();
  expect(writeText).toHaveBeenCalledWith("AAAA BBBB CCCC");
  expect(screen.getByRole("status").textContent).toBe("Ключ скопирован.");
});

it("selects the key and explains the manual fallback when copying fails", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("blocked")) },
  });
  render(<CopyTwoFactorSecret value="AAAA BBBB CCCC" />);

  fireEvent.click(screen.getByRole("button", { name: "Копировать" }));

  expect((await screen.findByRole("alert")).textContent).toContain("Ключ выделен");
  expect(document.activeElement).toBe(screen.getByLabelText("Ключ для ручного ввода"));
});

it("offers the manual fallback when clipboard permission never resolves", async () => {
  vi.useFakeTimers();
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: () => new Promise<void>(() => {}) },
  });
  render(<CopyTwoFactorSecret value="AAAA BBBB CCCC" />);

  fireEvent.click(screen.getByRole("button", { name: "Копировать" }));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });

  expect(screen.getByRole("alert").textContent).toContain("Ключ выделен");
  expect(screen.getByRole("button", { name: "Копировать" })).toHaveProperty("disabled", false);
});
