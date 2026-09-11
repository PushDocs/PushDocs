// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("@/app/actions", () => ({
  twoFactorStatusAction: vi.fn().mockResolvedValue(true),
  criticalSettingsAction: vi.fn().mockResolvedValue({}),
}));

import { ConnectionCard } from "./connection-card";

const connection = {
  baseUrl: "https://gitlab.example.test",
  id: "connection",
  kind: "gitlab" as const,
  name: "Sendsay",
  projectCount: 1,
};

afterEach(cleanup);

it("keeps the edit action in its connection row and opens the matching dialog", () => {
  const update = vi.fn().mockResolvedValue({ ok: true, message: "saved" });
  const remove = vi.fn().mockResolvedValue(undefined);
  const { container } = render(
    <ConnectionCard connection={connection} updateAction={update} deleteAction={remove} />,
  );
  const row = container.querySelector(".connection-row");
  expect(row).toBeTruthy();
  fireEvent.click(within(row as HTMLElement).getByRole("button", { name: "Редактировать" }));
  expect(screen.getByRole("dialog", { name: "Настройки подключения Sendsay" })).toBeTruthy();
});

it("closes after saving and announces the result", async () => {
  const update = vi
    .fn()
    .mockResolvedValue({ ok: true, message: "Настройки подключения сохранены" });
  render(
    <ConnectionCard
      connection={connection}
      updateAction={update}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  await screen.findByRole("heading", { name: "Подтвердите действие" });
  fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  expect((await screen.findByRole("status")).textContent).toBe("Настройки подключения сохранены");
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(update).toHaveBeenCalledOnce();
});

it("keeps the dialog open and announces an error when saving fails", async () => {
  const update = vi.fn().mockResolvedValue({
    ok: false,
    message: "Адрес нельзя изменить, пока подключение используется проектами.",
  });
  render(
    <ConnectionCard
      connection={connection}
      updateAction={update}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  await screen.findByRole("heading", { name: "Подтвердите действие" });
  fireEvent.submit(screen.getByRole("dialog").querySelector("form") as HTMLFormElement);
  expect((await screen.findByRole("alert")).textContent).toContain(
    "Адрес нельзя изменить, пока подключение используется проектами",
  );
  expect(screen.getByRole("dialog")).toBeTruthy();
});

it("keeps destructive controls in the matching connection dialog", () => {
  render(
    <ConnectionCard
      connection={{ ...connection, projectCount: 0 }}
      updateAction={vi.fn().mockResolvedValue({ ok: true, message: "saved" })}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  const dialog = screen.getByRole("dialog");
  expect(within(dialog).getByRole("heading", { name: "Удалить подключение" })).toBeTruthy();
  expect(dialog.querySelector('input[name="confirmation"]')).toBeTruthy();
});

it("explains why a used connection cannot be deleted", () => {
  render(
    <ConnectionCard
      connection={connection}
      updateAction={vi.fn().mockResolvedValue({ ok: true, message: "saved" })}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  expect(
    screen.getByText("Сначала удалите все проекты, которые используют это подключение."),
  ).toBeTruthy();
  expect(screen.getByRole("dialog").querySelector('input[name="confirmation"]')).toBeNull();
});

it("shows VPN controls only inside the selected connection dialog", () => {
  render(
    <ConnectionCard
      connection={{ ...connection, vpnSlot: 2 }}
      updateAction={vi.fn().mockResolvedValue({ ok: true, message: "saved" })}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  expect(screen.queryByText("Заменить профиль OpenVPN")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Редактировать" }));
  expect(screen.getByText("Заменить профиль OpenVPN")).toBeTruthy();
  expect(screen.getByRole("dialog").querySelector('input[name="removeVpn"]')).toBeTruthy();
});

it("closes the dialog with Escape and returns focus to the row action", async () => {
  render(
    <ConnectionCard
      connection={connection}
      updateAction={vi.fn().mockResolvedValue({ ok: true, message: "saved" })}
      deleteAction={vi.fn().mockResolvedValue(undefined)}
    />,
  );
  const edit = screen.getByRole("button", { name: "Редактировать" });
  fireEvent.click(edit);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  await Promise.resolve();
  expect(document.activeElement).toBe(edit);
});
