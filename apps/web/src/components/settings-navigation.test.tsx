// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it } from "vitest";
import { SettingsNavigation } from "./settings-navigation";

afterEach(cleanup);
it("links settings sections within the project and highlights the current section", () => {
  render(<SettingsNavigation projectId="project" active="members" canManageConnections />);
  expect(screen.getByRole("link", { name: "Проект" }).getAttribute("href")).toBe(
    "/projects/project/settings",
  );
  expect(screen.getByRole("link", { name: "Участники" }).getAttribute("href")).toBe(
    "/projects/project/settings/members",
  );
  expect(screen.getByRole("link", { name: "Участники" }).getAttribute("aria-current")).toBe("page");
  expect(screen.getByRole("link", { name: "Git-подключения" }).getAttribute("href")).toBe(
    "/projects/project/settings/connections",
  );
});
it("hides installation connections from non-operators while keeping project members accessible", () => {
  render(<SettingsNavigation projectId="project" active="project" canManageConnections={false} />);
  expect(screen.queryByRole("link", { name: "Git-подключения" })).toBeNull();
  expect(screen.getByRole("link", { name: "Участники" })).toBeTruthy();
});

it.each(["project", "members", "profile", "connections"] as const)(
  "keeps all tabs in the project context on %s",
  (active) => {
    const html = renderToStaticMarkup(
      <SettingsNavigation projectId="project" active={active} canManageConnections />,
    );
    for (const suffix of ["", "/members", "/profile", "/connections"]) {
      expect(html).toContain(`href="/projects/project/settings${suffix}"`);
    }
    expect(html).toContain("Участники");
    expect(html).not.toContain('href="/settings/profile"');
  },
);

it("does not invent a project in global settings", () => {
  const html = renderToStaticMarkup(
    <SettingsNavigation active="profile" canManageConnections={false} />,
  );
  expect(html).toContain('href="/settings/profile"');
  expect(html).not.toContain("Участники");
  expect(html).not.toContain("Git-подключения");
});
