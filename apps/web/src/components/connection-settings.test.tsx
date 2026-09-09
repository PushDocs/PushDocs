import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operator: vi.fn().mockResolvedValue({ id: "operator" }),
  access: vi.fn().mockResolvedValue({ role: "admin" }),
  connections: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/server", () => ({
  requireOperator: mocks.operator,
  repository: () => ({ requireProjectAccess: mocks.access, listConnections: mocks.connections }),
}));
vi.mock("@/app/actions", () => ({ createConnectionAction: vi.fn() }));

import { ConnectionSettings } from "./connection-settings";

it("retains the project settings navigation and form context", async () => {
  const html = renderToStaticMarkup(await ConnectionSettings({ projectId: "project" }));
  expect(mocks.access).toHaveBeenCalledWith("operator", "project");
  expect(html).toContain('href="/projects/project/settings/members"');
  expect(html).toContain('name="projectId" value="project"');
});
it("requires operator access before loading connections", async () => {
  mocks.operator.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(ConnectionSettings({ projectId: "project" })).rejects.toThrow("Forbidden");
  expect(mocks.connections).not.toHaveBeenCalled();
});
it("supports installation setup without a project", async () => {
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(mocks.access).not.toHaveBeenCalled();
  expect(html).toContain("Новое подключение");
  expect(html).not.toContain('name="projectId"');
});
