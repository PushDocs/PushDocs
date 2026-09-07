// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ pathname: "/projects/one/documents" }));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname }));
vi.mock("next/link", () => ({
  default: ({ children, href, ...props }: { children: ReactNode; href: string }) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));
vi.mock("@/app/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("./realtime-refresh", () => ({ RealtimeRefresh: () => null }));

import { AppShell } from "./app-shell";

const projects = [
  {
    defaultBranch: "main",
    id: "one",
    name: "Product Docs",
    openChangeRequests: 2,
    provider: "gitlab" as const,
    providerLabel: "GitLab",
    role: "admin" as const,
    slug: "product-docs",
    syncStatus: "current" as const,
    updatedAt: "2026-01-01T00:00:00.000Z",
  },
  {
    defaultBranch: "stable",
    id: "two",
    name: "API Docs",
    openChangeRequests: 0,
    provider: "github" as const,
    providerLabel: "GitHub",
    role: "reader" as const,
    slug: "api-docs",
    syncStatus: "attention" as const,
    updatedAt: "2026-01-02T00:00:00.000Z",
  },
];

const operator = {
  displayName: "Anna",
  email: "anna@example.test",
  id: "user",
  isInstanceOperator: true,
};

afterEach(cleanup);

describe("AppShell", () => {
  it("shows the active project navigation and operator controls", () => {
    const { container } = render(
      <AppShell projects={projects} user={operator}>
        <p>Page content</p>
      </AppShell>,
    );
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(screen.getByText("Администратор")).toBeTruthy();
    expect(screen.getByRole("link", { name: /Все проекты/ }).getAttribute("href")).toBe(
      "/projects",
    );
    expect(screen.getByRole("link", { name: "Документы" }).className).toBe("active");
    expect(screen.getByRole("link", { name: "PR / MR" }).getAttribute("href")).toBe(
      "/projects/one/reviews",
    );
    expect(screen.getByRole("link", { name: "Подключения" })).toBeTruthy();
    expect(container.querySelector(".app-frame")?.className).toBe("app-frame");

    fireEvent.click(screen.getByRole("button", { name: "Свернуть меню" }));
    expect(container.querySelector(".app-frame")?.className).toBe("app-frame sidebar-collapsed");
    expect(screen.getByRole("button", { name: "Развернуть меню" })).toBeTruthy();
  });

  it("shows all project choices in the switcher", () => {
    render(
      <AppShell projects={projects} user={operator}>
        Content
      </AppShell>,
    );
    const switcher = screen.getByRole("navigation", { name: "Сменить проект" });
    expect(switcher.querySelectorAll("a")).toHaveLength(2);
    expect(switcher.querySelector('a[href="/projects/two/documents"]')?.textContent).toContain(
      "API Docs",
    );
  });

  it("shows a project hint and hides installation controls for regular users", () => {
    mocks.pathname = "/projects";
    render(
      <AppShell projects={projects} user={{ ...operator, isInstanceOperator: false }}>
        Content
      </AppShell>,
    );
    expect(screen.getByText("Выберите проект")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
    expect(screen.getByText("anna@example.test")).toBeTruthy();
  });

  it("labels an active reader role", () => {
    mocks.pathname = "/projects/two/documents";
    render(
      <AppShell projects={projects} user={{ ...operator, isInstanceOperator: false }}>
        Content
      </AppShell>,
    );
    expect(screen.getByText("Читатель")).toBeTruthy();
  });
});
