// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { type MouseEventHandler, type ReactNode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pathname: "/projects/one/documents",
  push: vi.fn(),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ usePathname: () => mocks.pathname, useRouter: () => mocks }));
vi.mock("@pushdocs/ui", () => ({
  SearchableSelect: ({
    label,
    options,
    value,
    fallbackLabel,
    onValueChange,
  }: {
    label: string;
    options: Array<{ label: string; value: string }>;
    value: string;
    fallbackLabel: string;
    onValueChange: (value: string) => void;
  }) => {
    const [open, setOpen] = useState(false);
    return (
      <div>
        <button
          role="combobox"
          aria-expanded={open}
          aria-label={label}
          type="button"
          onClick={() => setOpen(!open)}
        >
          {options.find((item) => item.value === value)?.label ?? fallbackLabel}
        </button>
        {open ? (
          <div role="listbox">
            {options.map((item) => (
              <button
                role="option"
                type="button"
                key={item.value}
                onClick={() => onValueChange(item.value)}
              >
                {item.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    );
  },
}));
vi.mock("next/link", () => ({
  default: ({
    children,
    href,
    prefetch: _prefetch,
    onClick,
    ...props
  }: {
    children: ReactNode;
    href: string;
    prefetch?: boolean;
    onClick?: MouseEventHandler<HTMLAnchorElement>;
  }) => (
    <a
      href={href}
      {...props}
      onClick={(event) => {
        event.preventDefault();
        onClick?.(event);
      }}
    >
      {children}
    </a>
  ),
}));
vi.mock("@/app/actions", () => ({ logoutAction: vi.fn() }));
vi.mock("./realtime-refresh", () => ({ RealtimeRefresh: () => null }));

import { AppShell } from "./app-shell";
import { ProjectContext } from "./project-context";

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
beforeEach(() => {
  sessionStorage.clear();
  mocks.push.mockClear();
  mocks.refresh.mockClear();
  mocks.pathname = "/projects/one/documents";
  window.history.replaceState({}, "", "/");
});

describe("AppShell", () => {
  it("preserves the branch and last document across project screens without leaking to another project", () => {
    sessionStorage.setItem("pushdocs:branch:one", "docs/fix");
    sessionStorage.setItem(
      "pushdocs:tabs:one:docs/fix",
      JSON.stringify({ selected: "docs/send.mdx" }),
    );
    mocks.pathname = "/projects/one/settings";
    const { rerender } = render(
      <AppShell projects={projects} user={operator}>
        Settings
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "Документы" }).getAttribute("href")).toBe(
      "/projects/one/documents?branch=docs%2Ffix&path=docs%2Fsend.mdx",
    );
    expect(screen.getByRole("link", { name: "Изменения" }).getAttribute("href")).toBe(
      "/projects/one/changes?branch=docs%2Ffix",
    );
    mocks.pathname = "/projects/two/documents";
    rerender(
      <AppShell projects={projects} user={operator}>
        Other
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "PR" }).getAttribute("href")).toBe(
      "/projects/two/reviews?branch=stable",
    );
  });
  it("respects an explicit branch URL over remembered context", () => {
    sessionStorage.setItem("pushdocs:branch:one", "old");
    window.history.replaceState({}, "", "/projects/one/documents?branch=new");
    render(
      <AppShell projects={projects} user={operator}>
        Content
      </AppShell>,
    );
    expect(screen.getByRole("link", { name: "MR" }).getAttribute("href")).toBe(
      "/projects/one/reviews?branch=new",
    );
  });
  it("shows the active project navigation and operator controls", () => {
    const { container } = render(
      <AppShell projects={projects} user={operator}>
        <p>Page content</p>
      </AppShell>,
    );
    expect(screen.getByText("Page content")).toBeTruthy();
    expect(screen.queryByText("Администратор")).toBeNull();
    expect(screen.getByRole("link", { name: "Все проекты" }).getAttribute("href")).toBe(
      "/projects",
    );
    expect(screen.queryByRole("link", { name: "Файлы" })).toBeNull();
    expect(screen.getByRole("link", { name: "Документы" }).className).toBe("active");
    expect(screen.getByRole("link", { name: "MR" }).getAttribute("href")).toBe(
      "/projects/one/reviews?branch=main",
    );
    expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Пользователи" })).toBeNull();
    expect(screen.getByRole("link", { name: "Настройки" })).toBeTruthy();
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
    expect(switcher.textContent).not.toContain("stable");
  });

  it("shows a project hint and hides installation controls for regular users", () => {
    mocks.pathname = "/projects";
    render(
      <AppShell projects={projects} user={{ ...operator, isInstanceOperator: false }}>
        Content
      </AppShell>,
    );
    expect(screen.queryByRole("navigation", { name: "Разделы проекта" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
    expect(screen.getByText("anna@example.test")).toBeTruthy();
  });

  it("does not present the active role as a switchable project value", () => {
    mocks.pathname = "/projects/two/documents";
    render(
      <AppShell projects={projects} user={{ ...operator, isInstanceOperator: false }}>
        Content
      </AppShell>,
    );
    expect(screen.queryByText("Читатель")).toBeNull();
  });
});

it("shows the working branch while browsing a different MR, then updates on an explicit switch", () => {
  sessionStorage.setItem("pushdocs:branch:one", "docs/my-work");
  mocks.pathname = "/projects/one/reviews";
  window.history.replaceState({}, "", "/projects/one/reviews?branch=docs/other&review=42");
  const view = render(
    <AppShell projects={projects} user={operator}>
      MR
    </AppShell>,
  );
  expect(screen.getByTitle("Текущая ветка: docs/my-work")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Документы" }).getAttribute("href")).toBe(
    "/projects/one/documents?branch=docs%2Fmy-work",
  );
  expect(screen.getByRole("link", { name: "Изменения" }).getAttribute("href")).toBe(
    "/projects/one/changes?branch=docs%2Fmy-work",
  );
  window.history.replaceState({}, "", "/projects/one/documents?branch=docs/other");
  mocks.pathname = "/projects/one/documents";
  view.rerender(
    <AppShell projects={projects} user={operator}>
      <ProjectContext projectId="one" branch="docs/other" />
    </AppShell>,
  );
  expect(screen.getByTitle("Текущая ветка: docs/other")).toBeTruthy();
  expect(sessionStorage.getItem("pushdocs:branch:one")).toBe("docs/other");
  mocks.pathname = "/projects/one/reviews";
  window.history.replaceState({}, "", "/projects/one/reviews?review=99");
  view.rerender(
    <AppShell projects={projects} user={operator}>
      Another MR
    </AppShell>,
  );
  expect(screen.getByTitle("Текущая ветка: docs/other")).toBeTruthy();
});

it("switches away from an unavailable branch through the sidebar picker", async () => {
  window.history.replaceState({}, "", "/projects/one/documents?branch=doc%2F790&path=old.md");
  render(
    <AppShell
      projects={projects}
      branchesByProject={{
        one: [{ full_ref: "main" }, { full_ref: "release/2" }],
        two: [{ full_ref: "other-project" }],
      }}
      user={operator}
    >
      Import failed
    </AppShell>,
  );
  const picker = screen.getByRole("combobox", { name: "Выбрать текущую ветку" });
  expect(picker.textContent).toContain("doc/790");
  fireEvent.click(picker);
  const option = await screen.findByRole("option", { name: "release/2" });
  expect(screen.queryByRole("option", { name: "doc/790" })).toBeNull();
  expect(screen.queryByRole("option", { name: "other-project" })).toBeNull();
  fireEvent.click(option);
  expect(mocks.push).toHaveBeenCalledWith("/projects/one/documents?branch=release%2F2");
  expect(sessionStorage.getItem("pushdocs:branch:one")).toBe("release/2");
  expect(screen.getByRole("link", { name: "Изменения" }).getAttribute("href")).toBe(
    "/projects/one/changes?branch=release%2F2",
  );
});

it("keeps the changes section when switching branches", async () => {
  mocks.pathname = "/projects/one/changes";
  render(
    <AppShell
      projects={projects}
      branchesByProject={{ one: [{ full_ref: "main" }, { full_ref: "release/2" }] }}
      user={operator}
    >
      Changes
    </AppShell>,
  );
  fireEvent.click(screen.getByRole("combobox", { name: "Выбрать текущую ветку" }));
  fireEvent.click(await screen.findByRole("option", { name: "release/2" }));
  expect(mocks.push).toHaveBeenCalledWith("/projects/one/changes?branch=release%2F2");
});

it.each(["one", "two"])("closes the project menu when choosing project %s", (project) => {
  const { container } = render(
    <AppShell projects={projects} user={operator}>
      Content
    </AppShell>,
  );
  const menu = container.querySelector("details");
  if (!menu) throw new Error("Project menu missing");
  const trigger = menu.querySelector("summary");
  if (!trigger) throw new Error("Project menu trigger missing");
  fireEvent.click(trigger);
  expect(menu.open).toBe(true);
  fireEvent.click(
    screen.getByRole("link", { name: project === "one" ? /Product Docs/ : /API Docs/ }),
  );
  expect(menu.open).toBe(false);
});

it("keeps the project menu open for inside interaction and closes it outside or on Escape", () => {
  const { container } = render(
    <AppShell projects={projects} user={operator}>
      <p>Content</p>
    </AppShell>,
  );
  const menu = container.querySelector("details");
  if (!menu) throw new Error("Project menu missing");
  const trigger = menu.querySelector("summary");
  if (!trigger) throw new Error("Project menu trigger missing");
  fireEvent.click(trigger);
  fireEvent.pointerDown(screen.getByRole("navigation", { name: "Сменить проект" }));
  expect(menu.open).toBe(true);
  fireEvent.pointerDown(screen.getByText("Content"));
  expect(menu.open).toBe(false);
  fireEvent.click(trigger);
  expect(menu.open).toBe(true);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(menu.open).toBe(false);
  expect(document.activeElement).toBe(trigger);
});

it("closes the project menu on route navigation", () => {
  const view = render(
    <AppShell projects={projects} user={operator}>
      Content
    </AppShell>,
  );
  const menu = view.container.querySelector("details");
  if (!menu) throw new Error("Project menu missing");
  const trigger = menu.querySelector("summary");
  if (!trigger) throw new Error("Project menu trigger missing");
  fireEvent.click(trigger);
  mocks.pathname = "/projects/one/settings";
  view.rerender(
    <AppShell projects={projects} user={operator}>
      Settings
    </AppShell>,
  );
  expect(menu.open).toBe(false);
});

it.each([
  "/projects/one/settings/members",
  "/projects/one/settings/connections",
  "/projects/one/members",
])("marks Settings active on %s", (pathname) => {
  mocks.pathname = pathname;
  render(
    <AppShell projects={projects} user={operator}>
      Settings
    </AppShell>,
  );
  expect(screen.getByRole("link", { name: "Настройки" }).className).toBe("active");
  expect(screen.queryByRole("link", { name: "Пользователи" })).toBeNull();
  expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
});
it("keeps Settings accessible for an operator before any project exists", () => {
  mocks.pathname = "/projects";
  render(
    <AppShell projects={[]} user={operator}>
      Projects
    </AppShell>,
  );
  expect(screen.getByRole("link", { name: "Настройки" }).getAttribute("href")).toBe(
    "/settings/connections",
  );
  expect(screen.queryByRole("link", { name: "Подключения" })).toBeNull();
});
