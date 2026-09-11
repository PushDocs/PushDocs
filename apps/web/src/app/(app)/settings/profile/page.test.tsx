import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ selected: vi.fn(), access: vi.fn(), redirect: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/settings-project", () => ({
  settingsProjectId: mocks.selected,
  settingsProjectChoices: async () => [],
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user", isInstanceOperator: true }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    getSecurityUser: async () => ({ totp_secret: null }),
  }),
}));
vi.mock("@/app/actions", () => ({ beginTwoFactorAction: vi.fn() }));
vi.mock("@/components/critical-form", () => ({ CriticalForm: () => null }));

import ProfilePage from "./page";

beforeEach(() => {
  mocks.redirect.mockImplementation(() => {
    throw new Error("REDIRECT");
  });
});
it("restores project tabs from the global profile URL", async () => {
  mocks.selected.mockResolvedValue("project");
  await expect(ProfilePage({ searchParams: Promise.resolve({}) })).rejects.toThrow("REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/projects/project/settings/profile");
});
it("keeps form errors when restoring the project", async () => {
  mocks.selected.mockResolvedValue("project");
  await expect(
    ProfilePage({ searchParams: Promise.resolve({ error: "password" }) }),
  ).rejects.toThrow("REDIRECT");
  expect(mocks.redirect).toHaveBeenCalledWith("/projects/project/settings/profile?error=password");
});
it("checks access for project profile URLs", async () => {
  await ProfilePage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({}),
  });
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
  expect(mocks.selected).not.toHaveBeenCalled();
});
