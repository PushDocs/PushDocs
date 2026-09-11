// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModal, useSettingsModal } from "./settings-modal";

afterEach(cleanup);
it("asks before discarding entered data and supports returning to edit", () => {
  const close = vi.fn();
  render(
    <SettingsModal title="Connection" onClose={close}>
      <input aria-label="Name" />
    </SettingsModal>,
  );
  fireEvent.input(screen.getByLabelText("Name"), { target: { value: "Draft" } });
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  fireEvent.click(screen.getByText("Продолжить редактирование"));
  expect((screen.getByLabelText("Name") as HTMLInputElement).value).toBe("Draft");
  fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));
  fireEvent.click(screen.getByText("Закрыть без сохранения"));
  expect(close).toHaveBeenCalledOnce();
});
it("does not close during submission", () => {
  function Sending() {
    const modal = useSettingsModal();
    return (
      <button type="button" onClick={() => modal.setPending(true)}>
        Send
      </button>
    );
  }
  const close = vi.fn();
  render(
    <SettingsModal title="Connection" onClose={close}>
      <Sending />
    </SettingsModal>,
  );
  fireEvent.click(screen.getByText("Send"));
  fireEvent(screen.getByRole("dialog"), new Event("cancel", { bubbles: true, cancelable: true }));
  expect(close).not.toHaveBeenCalled();
  expect((screen.getByRole("button", { name: "Закрыть" }) as HTMLButtonElement).disabled).toBe(
    true,
  );
});
