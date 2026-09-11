"use client";

import {
  CheckCircle2,
  CircleAlert,
  Code2,
  GitBranch,
  Pencil,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

type SaveResult = { ok: boolean; message: string };

interface ConnectionItem {
  id: string;
  name: string;
  baseUrl: string;
  kind: "github" | "gitlab";
  projectCount: number;
  vpnSlot?: number | null;
}

function projectsLabel(count: number): string {
  const form = new Intl.PluralRules("ru").select(count);
  const noun = form === "one" ? "проект" : form === "few" ? "проекта" : "проектов";
  return `${count} ${noun}`;
}

export function ConnectionCard({
  connection,
  projectId,
  updateAction,
  deleteAction,
}: {
  connection: ConnectionItem;
  projectId?: string;
  updateAction: (formData: FormData) => Promise<SaveResult>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [notification, setNotification] = useState<SaveResult>();
  const modal = useRef<HTMLElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = modal.current;
    node?.querySelector<HTMLInputElement>('input[name="name"]')?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || pending) return;
      setOpen(false);
      queueMicrotask(() => trigger.current?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, pending]);

  const close = () => {
    if (pending) return;
    setOpen(false);
    queueMicrotask(() => trigger.current?.focus());
  };

  return (
    <article className="connection-card">
      <div className="connection-row">
        <span className="provider-icon">
          {connection.kind === "github" ? <Code2 aria-hidden /> : <GitBranch aria-hidden />}
        </span>
        <span className="connection-summary">
          <strong>{connection.name}</strong>
          <small>{connection.baseUrl}</small>
          <small>{projectsLabel(connection.projectCount)}</small>
          {connection.vpnSlot ? (
            <small className="connection-vpn-status">
              <ShieldCheck aria-hidden size={14} /> VPN настроен
            </small>
          ) : null}
        </span>
        <span className="connection-kind">{connection.kind}</span>
        <button
          className="connection-edit-trigger"
          type="button"
          ref={trigger}
          onClick={() => {
            setNotification(undefined);
            setOpen(true);
          }}
        >
          <Pencil aria-hidden size={15} />
          Редактировать
        </button>
      </div>

      {notification ? (
        <div
          className={`settings-notification settings-notification--${notification.ok ? "success" : "error"}`}
          role={notification.ok ? "status" : "alert"}
        >
          {notification.ok ? (
            <CheckCircle2 aria-hidden size={18} />
          ) : (
            <CircleAlert aria-hidden size={18} />
          )}
          <span>{notification.message}</span>
          <button
            type="button"
            aria-label="Закрыть уведомление"
            onClick={() => setNotification(undefined)}
          >
            <X aria-hidden size={16} />
          </button>
        </div>
      ) : null}

      {open ? (
        <div className="settings-modal-backdrop">
          <section
            className="settings-modal connection-modal"
            ref={modal}
            role="dialog"
            aria-modal="true"
            aria-label={`Настройки подключения ${connection.name}`}
          >
            <header>
              <div>
                <h2>{connection.name}</h2>
                <p>{connection.baseUrl}</p>
              </div>
              <button type="button" aria-label="Закрыть" disabled={pending} onClick={close}>
                <X aria-hidden size={18} />
              </button>
            </header>
            <form
              className="connection-edit-form"
              aria-busy={pending}
              onSubmit={async (event) => {
                event.preventDefault();
                setPending(true);
                setNotification(undefined);
                try {
                  const result = await updateAction(new FormData(event.currentTarget));
                  setNotification(result);
                  if (result.ok) setOpen(false);
                } catch {
                  setNotification({
                    ok: false,
                    message: "Не удалось сохранить настройки. Повторите попытку.",
                  });
                } finally {
                  setPending(false);
                }
              }}
            >
              <input name="connectionId" type="hidden" value={connection.id} />
              {projectId ? <input name="projectId" type="hidden" value={projectId} /> : null}
              <label>
                Название
                <input name="name" defaultValue={connection.name} required />
              </label>
              <label>
                Адрес
                <input
                  name="baseUrl"
                  type="url"
                  defaultValue={connection.baseUrl}
                  readOnly={connection.projectCount > 0}
                  required
                />
                {connection.projectCount > 0 ? (
                  <small>Адрес нельзя менять, пока подключение используется проектами.</small>
                ) : null}
              </label>
              <label>
                Новый access token
                <input
                  name="token"
                  type="password"
                  autoComplete="off"
                  placeholder="Оставьте пустым, чтобы сохранить текущий"
                />
              </label>
              {connection.kind === "gitlab" ? (
                <label>
                  {connection.vpnSlot ? "Заменить профиль OpenVPN" : "Профиль OpenVPN"}
                  <input
                    name="vpnProfile"
                    type="file"
                    accept=".ovpn,application/x-openvpn-profile,text/plain"
                  />
                  <small>Самодостаточный .ovpn с встроенными CA, сертификатом и ключом.</small>
                </label>
              ) : null}
              {connection.kind === "gitlab" && connection.vpnSlot ? (
                <label className="checkbox-row">
                  <input name="removeVpn" type="checkbox" />
                  Отключить VPN для этого подключения
                </label>
              ) : null}
              <footer className="settings-modal-actions">
                <button
                  className="pd-button pd-button--secondary"
                  type="button"
                  disabled={pending}
                  onClick={close}
                >
                  Отмена
                </button>
                <button className="pd-button pd-button--primary" type="submit" disabled={pending}>
                  {pending ? "Сохраняем…" : "Сохранить изменения"}
                </button>
              </footer>
            </form>
            <div className="connection-danger">
              <h3>Удалить подключение</h3>
              {connection.projectCount > 0 ? (
                <p>Сначала удалите все проекты, которые используют это подключение.</p>
              ) : (
                <form action={deleteAction}>
                  <input name="connectionId" type="hidden" value={connection.id} />
                  <label>
                    Введите <strong>{connection.name}</strong> для подтверждения
                    <input name="confirmation" required autoComplete="off" />
                  </label>
                  <button className="pd-button pd-button--danger" type="submit">
                    <Trash2 aria-hidden size={15} />
                    Удалить подключение
                  </button>
                </form>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </article>
  );
}
