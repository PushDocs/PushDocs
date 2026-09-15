import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ invitation: vi.fn(), current: vi.fn() }));
vi.mock("@pushdocs/db", () => ({ hashInvitationToken: (token: string) => `hash:${token}` }));
vi.mock("@/app/actions", () => ({ acceptInvitationAction: vi.fn() }));
vi.mock("@/lib/server", () => ({
  repository: () => ({ getInvitation: mocks.invitation }),
  optionalUser: mocks.current,
}));

import InvitationPage from "./page";

beforeEach(() => {
  mocks.current.mockResolvedValue(null);
  mocks.invitation.mockResolvedValue({
    email: "reader@example.test",
    project_name: "Docs",
    role: "reader",
  });
});

it.each([
  ["password", "Пароль должен содержать от 12 до 200 символов."],
  ["name", "Имя должно содержать от 2 до 80 символов."],
  ["credentials", "Пароль существующей учётной записи не подошёл."],
])("shows the invitation form with a readable %s error", async (error, message) => {
  const html = renderToStaticMarkup(
    await InvitationPage({
      params: Promise.resolve({ token: "a".repeat(20) }),
      searchParams: Promise.resolve({ error }),
    }),
  );
  expect(html).toContain('role="alert"');
  expect(html).toContain(message);
  expect(html).toContain("Принять приглашение");
  expect(html).toContain('minLength="12"');
  expect(html).toContain('maxLength="200"');
});
