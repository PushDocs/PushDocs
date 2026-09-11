import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  access: vi.fn().mockResolvedValue({ role: "admin" }),
  branches: vi.fn().mockResolvedValue([]),
  components: vi.fn().mockResolvedValue([]),
  projects: vi.fn().mockResolvedValue([
    {
      defaultBranch: "stable",
      id: "project",
      name: "Docs",
      providerLabel: "GitLab",
      role: "admin",
    },
  ]),
  settings: vi.fn().mockResolvedValue({
    default_branch: "stable",
    id: "project",
    name: "Docs",
    provider_name: "GitLab",
    root_path: ".",
    slug: "docs",
  }),
}));

vi.mock("@/app/actions", () => ({
  deleteProjectAction: vi.fn(),
  updateProjectAction: vi.fn(),
}));
vi.mock("@/components/component-catalog", () => ({ ComponentCatalog: () => null }));
vi.mock("@/components/component-examples", () => ({ componentExamples: () => [] }));
vi.mock("@/components/settings-navigation", () => ({ SettingsNavigation: () => null }));
vi.mock("@/lib/server", () => ({
  actor: (user: unknown) => user,
  application: () => ({ listProjects: mocks.projects }),
  repository: () => ({
    getProjectSettings: mocks.settings,
    listBranches: mocks.branches,
    listProjectComponents: mocks.components,
    requireProjectAccess: mocks.access,
  }),
  requireUser: async () => ({ id: "user", isInstanceOperator: true }),
}));

import ProjectSettingsPage from "./page";

it("allows project administrators to edit and delete a project", async () => {
  const html = renderToStaticMarkup(
    await ProjectSettingsPage({ params: Promise.resolve({ projectId: "project" }) }),
  );
  expect(html).toContain("Параметры проекта");
  expect(html).toContain('name="defaultBranch" value="stable"');
  expect(html).toContain('name="rootPath" value="."');
  expect(html).toContain("Удалить проект");
  expect(html).toContain('name="confirmation"');
});

it("keeps project management hidden from editors", async () => {
  mocks.access.mockResolvedValueOnce({ role: "editor" });
  const html = renderToStaticMarkup(
    await ProjectSettingsPage({ params: Promise.resolve({ projectId: "project" }) }),
  );
  expect(html).not.toContain("Параметры проекта");
  expect(html).not.toContain("Удалить проект");
});
