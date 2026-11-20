// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  selected: vi.fn(),
  choices: vi.fn(),
  access: vi.fn(),
  redirect: vi.fn(),
  user: vi.fn(),
  grants: vi.fn(),
  revoke: vi.fn(),
  revalidate: vi.fn(),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/settings-project", () => ({
  settingsProjectId: mocks.selected,
  settingsProjectChoices: mocks.choices,
}));
vi.mock("@/lib/server", () => ({
  requireUser: mocks.user,
  repository: () => ({ requireProjectAccess: mocks.access }),
}));
vi.mock("@/lib/mcp/oauth", () => ({
  mcpStore: () => ({ grants: mocks.grants, revokeGrant: mocks.revoke }),
  resourceUri: () => "https://docs.example.test/mcp",
}));
vi.mock("@/components/editor-settings", () => ({
  EditorSettings: () => <p>Editor preferences</p>,
}));

import ProjectEditorSettingsPage from "@/app/(app)/projects/[projectId]/settings/editor/page";
import ProjectMcpSettingsPage from "@/app/(app)/projects/[projectId]/settings/mcp/page";
import EditorSettingsPage from "@/app/(app)/settings/editor/page";
import McpSettingsPage from "@/app/(app)/settings/mcp/page";

beforeEach(() => {
  mocks.user.mockResolvedValue({ id: "user", isInstanceOperator: true });
  mocks.selected.mockResolvedValue(undefined);
  mocks.choices.mockResolvedValue([]);
  mocks.access.mockResolvedValue(undefined);
  mocks.grants.mockResolvedValue([]);
  mocks.redirect.mockImplementation(() => {
    throw new Error("REDIRECT");
  });
});
afterEach(cleanup);

function activeSettingsHref(html: string) {
  return new DOMParser()
    .parseFromString(html, "text/html")
    .querySelector('a[aria-current="page"]')
    ?.getAttribute("href");
}

describe.each([
  { section: "editor", page: EditorSettingsPage, projectPage: ProjectEditorSettingsPage },
  { section: "mcp", page: McpSettingsPage, projectPage: ProjectMcpSettingsPage },
])("$section settings context", ({ section, page, projectPage }) => {
  it("restores the selected project for a direct global URL", async () => {
    mocks.selected.mockResolvedValue("selected");
    await expect(page()).rejects.toThrow("REDIRECT");
    expect(mocks.redirect).toHaveBeenCalledWith(`/projects/selected/settings/${section}`);
    expect(mocks.grants).not.toHaveBeenCalled();
  });

  it("keeps every settings tab within the explicit project after checking access", async () => {
    mocks.selected.mockResolvedValue("another");
    const html = renderToStaticMarkup(
      await projectPage({ params: Promise.resolve({ projectId: "project" }) }),
    );
    expect(mocks.access).toHaveBeenCalledWith("user", "project");
    expect(mocks.selected).not.toHaveBeenCalled();
    for (const suffix of ["", "/members", "/profile", "/editor", "/mcp", "/connections"])
      expect(html).toContain(`href="/projects/project/settings${suffix}"`);
    expect(activeSettingsHref(html)).toBe(`/projects/project/settings/${section}`);
  });

  it("keeps global settings available with a project picker when none is selected", async () => {
    mocks.choices.mockResolvedValue([
      { id: "one", name: "First project" },
      { id: "two", name: "Second project" },
    ]);
    const html = renderToStaticMarkup(await page());
    expect(mocks.access).not.toHaveBeenCalled();
    expect(activeSettingsHref(html)).toBe(`/settings/${section}`);
    expect(html).toContain("First project");
    expect(html).toContain("Second project");
  });

  it("rejects project URLs without access before loading personal settings", async () => {
    mocks.access.mockRejectedValueOnce(new Error("Forbidden"));
    await expect(
      projectPage({ params: Promise.resolve({ projectId: "revoked" }) }),
    ).rejects.toThrow("Forbidden");
    expect(mocks.grants).not.toHaveBeenCalled();
  });
});

it("revokes a personal MCP grant and refreshes its global and project views", async () => {
  const grantId = "00000000-0000-4000-8000-000000000001";
  mocks.grants.mockResolvedValue([
    { id: grantId, name: "Codex", scopes: [], projects: [], created_at: new Date() },
  ]);
  render(await ProjectMcpSettingsPage({ params: Promise.resolve({ projectId: "project" }) }));
  const form = screen.getByRole("button", { name: "Отозвать доступ" }).closest("form");
  if (!form) throw new Error("Grant revocation form missing");
  fireEvent.submit(form);
  await waitFor(() => expect(mocks.revoke).toHaveBeenCalledWith(grantId, "user"));
  await waitFor(() =>
    expect(mocks.revalidate).toHaveBeenCalledWith("/projects/[projectId]/settings/mcp", "page"),
  );
  expect(mocks.revalidate).toHaveBeenCalledWith("/settings/mcp");
});
