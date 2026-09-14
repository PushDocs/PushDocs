import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  qr: vi.fn().mockResolvedValue("data:image/png;base64,qr"),
  redirect: vi.fn(),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("qrcode", () => ({ default: { toDataURL: mocks.qr } }));
vi.mock("@pushdocs/db", () => ({
  createTotpUri: (email: string, secret: string) => `otpauth://${email}/${secret}`,
  decryptSecret: () => "AAAA BBBB CCCC",
}));
vi.mock("@/app/actions", () => ({
  beginTwoFactorAction: vi.fn(),
  logoutAction: vi.fn(),
  verifyTwoFactorAction: vi.fn(),
}));
vi.mock("@/lib/two-factor", () => ({ authenticationSession: mocks.auth }));

import TwoFactorPage from "./page";

beforeEach(() => {
  mocks.auth.mockResolvedValue({
    id: "session",
    email: "admin@example.test",
    purpose: "setup",
    totp_pending_secret: "encrypted",
    totp_pending_expires_at: new Date(Date.now() + 60_000),
  });
});

it("renders two clear setup steps with one confirmation form", async () => {
  const html = renderToStaticMarkup(await TwoFactorPage({ searchParams: Promise.resolve({}) }));

  expect(html).toContain("auth-card--wide");
  expect(html).toContain("Добавьте аккаунт");
  expect(html).toContain("Подтвердите подключение");
  expect(html).toContain('alt="QR-код для подключения аутентификатора"');
  expect(html).toContain("Ключ для ручного ввода");
  expect(html.match(/name="otp"/g)).toHaveLength(1);
  expect(html).toContain("Включить 2FA");
  expect(mocks.qr).toHaveBeenCalledWith("otpauth://admin@example.test/AAAA BBBB CCCC", {
    width: 224,
  });
});

it("keeps the regular sign-in confirmation compact", async () => {
  mocks.auth.mockResolvedValueOnce({
    id: "session",
    email: "admin@example.test",
    purpose: "mfa",
    totp_pending_secret: null,
    totp_pending_expires_at: null,
  });
  const html = renderToStaticMarkup(await TwoFactorPage({ searchParams: Promise.resolve({}) }));

  expect(html).toContain("Подтвердите вход");
  expect(html).toContain("Подтвердить вход");
  expect(html).not.toContain("auth-card--wide");
  expect(html).not.toContain("Добавьте аккаунт");
});

it("shows a restart form when the setup window expired", async () => {
  mocks.auth.mockResolvedValueOnce({
    id: "session",
    email: "admin@example.test",
    purpose: "setup",
    totp_pending_secret: "encrypted",
    totp_pending_expires_at: new Date(Date.now() - 60_000),
  });
  const html = renderToStaticMarkup(await TwoFactorPage({ searchParams: Promise.resolve({}) }));

  expect(html).toContain("Настройка истекла");
  expect(html).toContain('name="password"');
  expect(html).not.toContain('name="otp"');
});
