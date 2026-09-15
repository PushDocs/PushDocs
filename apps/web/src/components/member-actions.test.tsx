// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  twoFactorStatusAction: vi.fn(),
  criticalSettingsAction: vi.fn(),
}));
vi.mock("@pushdocs/ui", () => ({
  Select: ({
    label,
    name,
    onValueChange,
    options,
    value,
  }: {
    label: string;
    name: string;
    onValueChange: (value: string) => void;
    options: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <select
      aria-label={label}
      name={name}
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

import { criticalSettingsAction, twoFactorStatusAction } from "@/app/actions";
import { CopyInvitation, MemberActions } from "./member-actions";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
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

it("separates revocation from roles and allows cancelling without losing the chosen role", async () => {
  render(
    // biome-ignore lint/a11y/useValidAriaRole: role is a domain-level component prop, not an ARIA attribute.
    <MemberActions
      projectId="3b63fe90-f569-4e0e-89e9-153948ba5a9e"
      userId="9d2c893f-8785-4b03-8568-e32655679be8"
      name="Reader"
      role="reader"
    />,
  );

  const trigger = screen.getByRole("button", { name: "Изменить доступ: Reader" });
  fireEvent.click(trigger);
  expect(screen.getByRole("dialog")).toBeTruthy();
  expect(screen.queryByRole("option", { name: "Отозвать доступ" })).toBeNull();
  fireEvent.change(screen.getByLabelText("Доступ к проекту"), { target: { value: "editor" } });
  fireEvent.click(screen.getByRole("button", { name: "Отозвать доступ" }));
  expect(screen.queryByLabelText("Доступ к проекту")).toBeNull();
  expect(criticalSettingsAction).not.toHaveBeenCalled();
  expect(screen.getByText(/Участник потеряет доступ/)).toBeTruthy();
  expect(screen.getByRole("button", { name: "Подтвердить отзыв доступа" }).className).toContain(
    "danger",
  );
  fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
  expect(screen.getByLabelText("Доступ к проекту")).toHaveProperty("value", "editor");

  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  expect(screen.queryByText(/Закрыть без сохранения/)).toBeNull();
  expect(screen.queryByRole("dialog")).toBeNull();

  fireEvent.click(trigger);
  expect(screen.getByLabelText("Доступ к проекту")).toHaveProperty("value", "reader");
  fireEvent.change(screen.getByLabelText("Доступ к проекту"), { target: { value: "admin" } });
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(criticalSettingsAction).not.toHaveBeenCalled();
});

it("closes the member dialog after a verified successful update", async () => {
  vi.mocked(twoFactorStatusAction).mockResolvedValue(true);
  vi.mocked(criticalSettingsAction).mockResolvedValue({});
  render(
    // biome-ignore lint/a11y/useValidAriaRole: role is a domain-level component prop, not an ARIA attribute.
    <MemberActions projectId="project" userId="reader" name="Reader" role="reader" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Изменить доступ: Reader" }));
  fireEvent.click(screen.getByRole("button", { name: "Сохранить роль" }));
  expect(await screen.findByLabelText("Код 2FA")).toBeTruthy();
  fireEvent.change(screen.getByLabelText("Код 2FA"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Доступ обновлён");
  expect(screen.queryByRole("dialog")).toBeNull();
});

it("requires confirmation and verification for the separate revoke action", async () => {
  vi.mocked(twoFactorStatusAction).mockResolvedValue(true);
  vi.mocked(criticalSettingsAction).mockResolvedValue({});
  render(
    // biome-ignore lint/a11y/useValidAriaRole: role is a domain-level component prop, not an ARIA attribute.
    <MemberActions projectId="project" userId="reader" name="Reader" role="reader" />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Изменить доступ: Reader" }));
  fireEvent.click(screen.getByRole("button", { name: "Отозвать доступ" }));
  expect(criticalSettingsAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить отзыв доступа" }));
  expect(await screen.findByLabelText("Код 2FA")).toBeTruthy();
  expect(criticalSettingsAction).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Код 2FA"), { target: { value: "123456" } });
  fireEvent.click(screen.getByRole("button", { name: "Подтвердить" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Доступ отозван");
  const call = vi.mocked(criticalSettingsAction).mock.calls[0];
  if (!call) throw new Error("Expected a verified revoke action");
  const [kind, data] = call;
  expect(kind).toBe("manageMember");
  expect(Object.fromEntries(data)).toMatchObject({
    projectId: "project",
    userId: "reader",
    role: "remove",
    otp: "123456",
  });
  expect(screen.queryByRole("dialog")).toBeNull();
});
