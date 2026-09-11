import { beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ projects: vi.fn(), cookie: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: mocks.cookie }) }));
vi.mock("./server", () => ({
  actor: (user: unknown) => user,
  application: () => ({ listProjects: mocks.projects }),
}));

import { settingsProjectId } from "./settings-project";

const user = {
  id: "user",
  displayName: "User",
  email: "user@example.test",
  isInstanceOperator: true,
};
beforeEach(() => {
  mocks.cookie.mockReturnValue(undefined);
});
it("restores the only project when opening global settings", async () => {
  mocks.projects.mockResolvedValue([{ id: "one" }]);
  expect(await settingsProjectId(user)).toBe("one");
});
it("restores the selected project among multiple projects", async () => {
  mocks.projects.mockResolvedValue([{ id: "one" }, { id: "two" }]);
  mocks.cookie.mockReturnValue({ value: "two" });
  expect(await settingsProjectId(user)).toBe("two");
});
it("does not use an inaccessible or stale project from the browser", async () => {
  mocks.projects.mockResolvedValue([{ id: "one" }, { id: "two" }]);
  mocks.cookie.mockReturnValue({ value: "revoked" });
  expect(await settingsProjectId(user)).toBeUndefined();
});
it("keeps global settings available without a project", async () => {
  mocks.projects.mockResolvedValue([]);
  expect(await settingsProjectId(user)).toBeUndefined();
});
