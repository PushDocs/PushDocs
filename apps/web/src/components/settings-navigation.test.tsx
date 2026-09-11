// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { SettingsNavigation } from "./settings-navigation";

afterEach(cleanup);
it("links settings sections within the project and highlights the current section", () => {
  render(<SettingsNavigation projectId="project" active="members" canManageConnections />);
  expect(screen.getByRole("link", { name: "Проект" }).getAttribute("href")).toBe(
    "/projects/project/settings",
  );
  expect(screen.getByRole("link", { name: "Пользователи" }).getAttribute("href")).toBe(
    "/projects/project/settings/members",
  );
  expect(screen.getByRole("link", { name: "Пользователи" }).getAttribute("aria-current")).toBe(
    "page",
  );
  expect(screen.getByRole("link", { name: "Подключения" }).getAttribute("href")).toBe(
    "/projects/project/settings/connections",
  );
});
it("hides installation connections from non-operators while keeping project members accessible", () => {
  render(<SettingsNavigation projectId="project" active="project" canManageConnections={false} />);
  expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
  expect(screen.getByRole("link", { name: "Пользователи" })).toBeTruthy();
});
