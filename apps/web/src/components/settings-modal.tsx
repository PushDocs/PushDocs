"use client";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

const ModalState = createContext({
  setPending: (_value: boolean) => {},
  pending: false,
  saved: () => {},
  close: () => {},
});
export const useSettingsModal = () => useContext(ModalState);

export function SettingsModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [dirty, setDirty] = useState(false);
  const [pending, setPending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (ref.current?.showModal) ref.current.showModal();
    else ref.current?.setAttribute("open", "");
    return () => previous?.focus();
  }, []);
  const close = () => {
    if (!pending) {
      if (dirty) setConfirm(true);
      else onClose();
    }
  };
  return (
    <ModalState.Provider value={{ setPending, pending, saved: () => setDirty(false), close }}>
      <dialog
        ref={ref}
        className="settings-modal create-connection-dialog"
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Tab") return;
          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              "button, [href], input, select, textarea, [tabindex]",
            ),
          ).filter(
            (element) =>
              element.tabIndex >= 0 &&
              !element.matches(":disabled") &&
              element.getClientRects().length > 0,
          );
          const first = focusable[0];
          const last = focusable.at(-1);
          if (event.shiftKey && document.activeElement === first) {
            event.preventDefault();
            last?.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault();
            first?.focus();
          }
        }}
        onInputCapture={() => setDirty(true)}
        onChangeCapture={() => setDirty(true)}
      >
        <header>
          <h2 id={titleId}>{title}</h2>
          <button type="button" aria-label="Закрыть" disabled={pending} onClick={close}>
            ×
          </button>
        </header>
        <div hidden={confirm}>{children}</div>
        {confirm ? (
          <section role="alert">
            <p>Закрыть без сохранения? Введённые данные будут потеряны.</p>
            <div className="settings-modal-actions">
              <button type="button" onClick={() => setConfirm(false)}>
                Продолжить редактирование
              </button>
              <button type="button" onClick={onClose}>
                Закрыть без сохранения
              </button>
            </div>
          </section>
        ) : null}
      </dialog>
    </ModalState.Provider>
  );
}

export function SettingsModalCancel() {
  const modal = useSettingsModal();
  return (
    <button type="button" className="pd-button pd-button--secondary" onClick={modal.close}>
      Отмена
    </button>
  );
}
