import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  operator: vi.fn().mockResolvedValue({ id: "operator" }),
  access: vi.fn().mockResolvedValue({ role: "admin" }),
  connections: vi.fn().mockResolvedValue([]),
  projectCount: vi.fn().mockResolvedValue(0),
}));
vi.mock("@/lib/server", () => ({
  requireOperator: mocks.operator,
  repository: () => ({
    countConnectionProjects: mocks.projectCount,
    requireProjectAccess: mocks.access,
    listConnections: mocks.connections,
  }),
}));
vi.mock("@/app/actions", () => ({
  createConnectionAction: vi.fn(),
  deleteConnectionAction: vi.fn(),
  updateConnectionAction: vi.fn(),
}));

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

it("renders edit and guarded delete controls for an unused connection", async () => {
  mocks.connections.mockResolvedValueOnce([
    {
      base_url: "https://gitlab.example.test",
      id: "connection",
      kind: "gitlab",
      name: "GitLab",
    },
  ]);
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(html).toContain("Редактировать");
  expect(html).toContain('name="token"');
  expect(html).toContain("Удалить подключение");
  expect(html).toContain('name="confirmation"');
});

it("blocks connection deletion while projects use it", async () => {
  mocks.connections.mockResolvedValueOnce([
    {
      base_url: "https://gitlab471.test",
      id: "used-connection",
      kind: "gitlab",
      name: "Used GitLab",
    },
  ]);
  mocks.projectCount.mockResolvedValueOnce(1);
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(html).toContain("Сначала удалите все проекты");
  expect(html).not.toContain('name="confirmation"');
});
