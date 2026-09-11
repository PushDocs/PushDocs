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
    listConnectionProjects: async () => [],
    requireProjectAccess: mocks.access,
    listConnections: mocks.connections,
  }),
}));
vi.mock("@/app/actions", () => ({
  createConnectionAction: vi.fn(),
  deleteConnectionAction: vi.fn(),
  saveConnectionSettingsAction: vi.fn(),
}));

vi.mock("@/lib/settings-project", () => ({ settingsProjectChoices: async () => [] }));

import { ConnectionSettings } from "./connection-settings";

it("retains the project settings navigation and form context", async () => {
  const html = renderToStaticMarkup(await ConnectionSettings({ projectId: "project" }));
  expect(mocks.access).toHaveBeenCalledWith("operator", "project");
  expect(html).toContain('href="/projects/project/settings/members"');
  expect(html).not.toContain('name="otp"');
});
it("requires operator access before loading connections", async () => {
  mocks.operator.mockRejectedValueOnce(new Error("Forbidden"));
  await expect(ConnectionSettings({ projectId: "project" })).rejects.toThrow("Forbidden");
  expect(mocks.connections).not.toHaveBeenCalled();
});
it("supports installation setup without a project", async () => {
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(mocks.access).not.toHaveBeenCalled();
  expect(html).toContain("Создать подключение");
  expect(html).not.toContain('name="projectId"');
});

it("renders an edit action for an unused connection", async () => {
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
  expect(html).toContain("0 проектов");
});

it("shows how many projects use a connection", async () => {
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
  expect(html).toContain("1 проект");
});

it("keeps a separate edit action in every connection row", async () => {
  mocks.connections.mockResolvedValueOnce([
    { base_url: "https://one.test", id: "one", kind: "gitlab", name: "One" },
    { base_url: "https://two.test", id: "two", kind: "github", name: "Two" },
  ]);
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(html.match(/connection-edit-trigger/g)).toHaveLength(2);
});

it("shows and allows replacing an attached OpenVPN profile", async () => {
  mocks.connections.mockResolvedValueOnce([
    {
      base_url: "https://gitlab.internal.test",
      id: "vpn-connection",
      kind: "gitlab",
      name: "Corporate GitLab",
      vpn_slot: 2,
    },
  ]);
  const html = renderToStaticMarkup(await ConnectionSettings({}));
  expect(html).toContain("VPN настроен");
  expect(html).not.toContain("BEGIN PRIVATE KEY");
});
