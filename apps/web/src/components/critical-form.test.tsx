// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ status: vi.fn(), save: vi.fn() }));
vi.mock("@/app/actions", () => ({
  twoFactorStatusAction: mocks.status,
  criticalSettingsAction: mocks.save,
}));

import { CriticalForm } from "./critical-form";

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function setup() {
  return render(
    <CriticalForm kind="createConnection">
      <label>
        Название
        <input name="name" defaultValue="Docs" />
      </label>
      <button type="submit">Сохранить</button>
    </CriticalForm>,
  );
}
it("requests the code only after submitting details and preserves them through verification", async () => {
  mocks.status.mockResolvedValue(true);
  mocks.save.mockResolvedValue({});
  const { container } = setup();
  expect(screen.queryByLabelText("Код 2FA")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  const otp = await screen.findByLabelText("Код 2FA");
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.change(otp, { target: { value: "123456" } });
  fireEvent.submit(container.querySelector("form") as HTMLFormElement);
  await screen.findByText("Изменения сохранены.");
  expect(mocks.save.mock.calls[0]?.[1].get("name")).toBe("Docs");
  expect(mocks.save.mock.calls[0]?.[1].get("otp")).toBe("123456");
});
it("offers setup without asking for an impossible code when 2FA is disabled", async () => {
  mocks.status.mockResolvedValue(false);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect(
    (await screen.findByRole("link", { name: "Настроить 2FA в профиле" })).getAttribute("href"),
  ).toBe("/settings/profile");
  expect(screen.queryByLabelText("Код 2FA")).toBeNull();
  expect(mocks.save).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Вернуться к форме" }));
  expect(screen.getByLabelText("Название")).toHaveProperty("value", "Docs");
});

it("keeps the action and object visible on the code step and restores input on back", async () => {
  mocks.status.mockResolvedValue(true);
  setup();
  fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Sendsay" } });
  fireEvent.click(screen.getByText("Сохранить"));
  const code = await screen.findByLabelText("Код 2FA");
  expect(screen.getByRole("heading").textContent).toBe("Создать подключение: Sendsay");
  expect(document.activeElement).toBe(code);
  fireEvent.click(screen.getByText("Назад"));
  expect(screen.getByLabelText("Название")).toHaveProperty("value", "Sendsay");
  expect(mocks.save).not.toHaveBeenCalled();
});
