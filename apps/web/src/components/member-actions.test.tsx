// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  twoFactorStatusAction: vi.fn(),
  criticalSettingsAction: vi.fn(),
}));

import { CopyInvitation } from "./member-actions";

afterEach(() => {
  cleanup();
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
