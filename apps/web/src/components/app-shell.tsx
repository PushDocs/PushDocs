"use client";

import type { ProjectSummary } from "@pushdocs/contracts";
import {
  BookOpenText,
  ChevronDown,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/actions";
import type { CurrentUser } from "@/lib/server";
import { documentHref, readProjectBranch } from "./project-context";
import { PushDocsLogo } from "./pushdocs-logo";
import { RealtimeRefresh } from "./realtime-refresh";

const projectNavigation = [
  { icon: BookOpenText, label: "Документы", segment: "documents" },
  { icon: SlidersHorizontal, label: "Изменения", segment: "changes" },
  { icon: GitPullRequest, label: "PR / MR", segment: "reviews" },
  { icon: Settings, label: "Настройки", segment: "settings" },
];

export function AppShell({
  children,
  projects,
  user,
}: {
  children: ReactNode;
  projects: ProjectSummary[];
  user: CurrentUser;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const projectSwitcherRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = match?.[1];
  const activeProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    const dismissOutside = (event: PointerEvent) => {
      const menu = projectSwitcherRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.open = false;
      }
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      const menu = projectSwitcherRef.current;
      if (event.key === "Escape" && menu?.open) {
        menu.open = false;
        menu.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismissOutside);
    document.addEventListener("keydown", dismissOnEscape);
    return () => {
      document.removeEventListener("pointerdown", dismissOutside);
      document.removeEventListener("keydown", dismissOnEscape);
    };
  }, []);

  const [currentBranch, setCurrentBranch] = useState("");
  useEffect(() => {
    if (projectSwitcherRef.current) projectSwitcherRef.current.open = false;
    const update = () => {
      if (!activeProject || !pathname.startsWith("/projects/")) return;
      const query = new URLSearchParams(window.location.search);
      setCurrentBranch(
        (/\/(documents|changes|preview)$/.test(pathname) ? query.get("branch") : null) ||
          readProjectBranch(activeProject.id, activeProject.defaultBranch),
      );
    };
    update();
    window.addEventListener("pushdocs:context", update);
    window.addEventListener("popstate", update);
    return () => {
      window.removeEventListener("pushdocs:context", update);
      window.removeEventListener("popstate", update);
    };
  }, [activeProject, pathname]);
  return (
    <div className={sidebarCollapsed ? "app-frame sidebar-collapsed" : "app-frame"}>
      <RealtimeRefresh />
      <aside className="app-sidebar">
        <div className="sidebar-brand">
          <PushDocsLogo compact />
          <button
            className="icon-button"
            type="button"
            aria-label={sidebarCollapsed ? "Развернуть меню" : "Свернуть меню"}
            onClick={() => setSidebarCollapsed((value) => !value)}
          >
            {sidebarCollapsed ? (
              <PanelLeftOpen aria-hidden size={17} />
            ) : (
              <PanelLeftClose aria-hidden size={17} />
            )}
          </button>
        </div>

        <Link
          className={pathname === "/projects" ? "sidebar-all active" : "sidebar-all"}
          href="/projects"
          title="Все проекты"
        >
          <FolderGit2 aria-hidden size={18} />
          Все проекты
          <span>{projects.length}</span>
        </Link>

        {activeProject ? (
          <>
            <details className="project-switcher-wrap" ref={projectSwitcherRef}>
              <summary className="project-switcher">
                <span className="project-monogram">
                  {activeProject.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{activeProject.name}</strong>
                  <small>
                    {activeProject.role === "admin"
                      ? "Администратор"
                      : activeProject.role === "editor"
                        ? "Редактор"
                        : "Читатель"}
                  </small>
                </span>
                <ChevronDown aria-hidden size={15} />
              </summary>
              <nav className="project-switch-menu" aria-label="Сменить проект">
                {projects.map((project) => (
                  <Link
                    href={`/projects/${project.id}/documents`}
                    key={project.id}
                    onClick={() => {
                      if (projectSwitcherRef.current) projectSwitcherRef.current.open = false;
                    }}
                  >
                    <span className="project-monogram">
                      {project.name.slice(0, 1).toUpperCase()}
                    </span>
                    <span>
                      <strong>{project.name}</strong>
                      <small>{project.defaultBranch}</small>
                    </span>
                  </Link>
                ))}
              </nav>
            </details>
            <div
              className="sidebar-branch"
              title={`Текущая ветка: ${currentBranch || activeProject.defaultBranch}`}
            >
              <GitBranch aria-hidden size={16} />
              <span>
                <small>Текущая ветка</small>
                <code>{currentBranch || activeProject.defaultBranch}</code>
              </span>
            </div>
            <nav className="sidebar-nav" aria-label="Разделы проекта">
              {projectNavigation.map((item) => {
                const Icon = item.icon;
                const href = `/projects/${activeProject.id}/${item.segment}`;
                const active =
                  pathname.startsWith(href) ||
                  (item.segment === "settings" &&
                    pathname === `/projects/${activeProject.id}/members`);
                const branch = currentBranch || activeProject.defaultBranch;
                const target =
                  item.segment === "documents" && currentBranch
                    ? documentHref(activeProject.id, branch)
                    : `${href}?${new URLSearchParams({ branch })}`;
                const label =
                  item.segment === "reviews"
                    ? activeProject.provider === "gitlab"
                      ? "MR"
                      : "PR"
                    : item.label;
                return (
                  <Link
                    className={active ? "active" : ""}
                    href={target}
                    key={item.segment}
                    title={label}
                  >
                    <Icon aria-hidden size={18} />
                    {label}
                  </Link>
                );
              })}
            </nav>
          </>
        ) : null}

        <div className="sidebar-spacer" />
        {!activeProject && user.isInstanceOperator ? (
          <Link
            className={
              pathname.startsWith("/settings") ? "sidebar-system active" : "sidebar-system"
            }
            href="/settings/connections"
            title="Настройки"
          >
            <Settings aria-hidden size={18} />
            Настройки
          </Link>
        ) : null}
        <div className="sidebar-profile">
          <span className="avatar">{user.displayName.slice(0, 1).toUpperCase()}</span>
          <span className="profile-copy">
            <strong>{user.displayName}</strong>
            <small>{user.isInstanceOperator ? "Оператор установки" : user.email}</small>
          </span>
          <form action={logoutAction}>
            <button className="icon-button" type="submit" aria-label="Выйти">
              <LogOut aria-hidden size={17} />
            </button>
          </form>
        </div>
      </aside>
      <main className="app-main">{children}</main>
    </div>
  );
}
