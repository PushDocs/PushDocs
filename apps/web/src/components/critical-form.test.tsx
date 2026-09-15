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
it("saves without an OTP or setup step when 2FA is disabled", async () => {
  mocks.status.mockResolvedValue(false);
  mocks.save.mockResolvedValue({});
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  await screen.findByText("Изменения сохранены.");
  expect(screen.queryByLabelText("Код 2FA")).toBeNull();
  expect(screen.queryByRole("link", { name: "Настроить 2FA в профиле" })).toBeNull();
  expect(mocks.save).toHaveBeenCalledTimes(1);
  expect(mocks.save.mock.calls[0]?.[1].get("name")).toBe("Docs");
  expect(mocks.save.mock.calls[0]?.[1].has("otp")).toBe(false);
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

it("blocks duplicate submissions and reports status and action failures", async () => {
  let finishStatus: ((enabled: boolean) => void) | undefined;
  mocks.status.mockImplementationOnce(
    () =>
      new Promise<boolean>((resolve) => {
        finishStatus = resolve;
      }),
  );
  const first = setup();
  const form = first.container.querySelector("form") as HTMLFormElement;
  fireEvent.submit(form);
  fireEvent.submit(form);
  expect(mocks.status).toHaveBeenCalledTimes(1);
  finishStatus?.(true);
  await screen.findByLabelText("Код 2FA");
  mocks.save.mockRejectedValueOnce(new Error("offline"));
  fireEvent.submit(form);
  expect((await screen.findByRole("alert")).textContent).toContain("Не удалось выполнить");
  first.unmount();

  mocks.status.mockResolvedValue(true);
  const action = vi.fn().mockResolvedValue({ ok: false, message: "Code expired" });
  const second = render(
    <CriticalForm action={action} description="Custom operation">
      <input name="name" defaultValue="Object" />
      <button type="submit">Save custom</button>
    </CriticalForm>,
  );
  fireEvent.submit(second.container.querySelector("form") as HTMLFormElement);
  expect(await screen.findByText("Custom operation")).toBeTruthy();
  fireEvent.submit(second.container.querySelector("form") as HTMLFormElement);
  expect((await screen.findByRole("alert")).textContent).toBe("Code expired");
});

it("does not execute the action if checking 2FA status fails", async () => {
  mocks.status.mockRejectedValueOnce(new Error("offline"));
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
  expect((await screen.findByRole("alert")).textContent).toContain("Не удалось выполнить");
  expect(mocks.save).not.toHaveBeenCalled();
  expect(screen.getByLabelText("Название")).toHaveProperty("value", "Docs");
});

it("retains details and retries a failed custom action without 2FA", async () => {
  mocks.status.mockResolvedValue(false);
  const action = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, message: "Failed" })
    .mockResolvedValueOnce({ ok: true, message: "Saved" });
  const onSuccess = vi.fn();
  render(
    <CriticalForm action={action} onSuccess={onSuccess}>
      <input name="name" defaultValue="Docs" />
      <button type="submit">Save</button>
    </CriticalForm>,
  );
  fireEvent.click(screen.getByText("Save"));
  await screen.findByRole("alert");
  expect(onSuccess).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Save"));
  await screen.findByText("Saved");
  expect(onSuccess).toHaveBeenCalledTimes(1);
  expect(action.mock.calls[1]?.[0].get("name")).toBe("Docs");
});
