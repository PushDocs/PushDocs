// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SettingsModal, SettingsModalCancel, useSettingsModal } from "./settings-modal";

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

it("closes from the shared cancel control and clears dirty state after saving", () => {
  function Controls() {
    const modal = useSettingsModal();
    return (
      <>
        <input aria-label="Name" />
        <button type="button" onClick={modal.saved}>
          Saved
        </button>
        <SettingsModalCancel />
      </>
    );
  }
  const close = vi.fn();
  render(
    <SettingsModal title="Connection" onClose={close}>
      <Controls />
    </SettingsModal>,
  );
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Changed" } });
  fireEvent.click(screen.getByText("Saved"));
  fireEvent.click(screen.getByText("Отмена"));
  expect(close).toHaveBeenCalledOnce();
});

it("cycles keyboard focus inside the dialog", () => {
  const original = HTMLElement.prototype.getClientRects;
  HTMLElement.prototype.getClientRects = () => ({ length: 1 }) as DOMRectList;
  try {
    render(
      <SettingsModal title="Connection" onClose={() => {}}>
        <button type="button">First</button>
        <button type="button">Last</button>
      </SettingsModal>,
    );
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Закрыть" });
    const last = screen.getByRole("button", { name: "Last" });
    last.focus();
    fireEvent.keyDown(dialog, { key: "Tab" });
    expect(document.activeElement).toBe(close);
    close.focus();
    fireEvent.keyDown(dialog, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(dialog, { key: "Escape" });
  } finally {
    HTMLElement.prototype.getClientRects = original;
  }
});

it("uses the native modal API when the browser provides it", () => {
  const showModal = vi.fn();
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", {
    configurable: true,
    value: showModal,
  });
  try {
    render(
      <SettingsModal title="Native" onClose={() => {}}>
        content
      </SettingsModal>,
    );
    expect(showModal).toHaveBeenCalledOnce();
  } finally {
    delete (HTMLDialogElement.prototype as { showModal?: unknown }).showModal;
  }
});

it("provides inert defaults when modal controls are used outside a provider", () => {
  function Outside() {
    const modal = useSettingsModal();
    return (
      <button
        type="button"
        onClick={() => {
          modal.setPending(true);
          modal.saved();
          modal.close();
        }}
      >
        Outside
      </button>
    );
  }
  render(<Outside />);
  fireEvent.click(screen.getByText("Outside"));
});
