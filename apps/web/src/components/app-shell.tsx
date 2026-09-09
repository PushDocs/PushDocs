"use client";

import type { ProjectSummary } from "@pushdocs/contracts";
import {
  BookOpenText,
  Cable,
  ChevronDown,
  FolderGit2,
  GitPullRequest,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  SlidersHorizontal,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";
import { logoutAction } from "@/app/actions";
import type { CurrentUser } from "@/lib/server";
import { PushDocsLogo } from "./pushdocs-logo";
import { RealtimeRefresh } from "./realtime-refresh";

const projectNavigation = [
  { icon: BookOpenText, label: "Документы", segment: "documents" },
  { icon: SlidersHorizontal, label: "Изменения", segment: "changes" },
  { icon: GitPullRequest, label: "PR / MR", segment: "reviews" },
  { icon: Users, label: "Участники", segment: "members" },
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
  const pathname = usePathname();
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = match?.[1];
  const activeProject = projects.find((project) => project.id === projectId);

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
            <details className="project-switcher-wrap">
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
                  <Link href={`/projects/${project.id}/documents`} key={project.id}>
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
            <nav className="sidebar-nav" aria-label="Разделы проекта">
              {projectNavigation.map((item) => {
                const Icon = item.icon;
                const href = `/projects/${activeProject.id}/${item.segment}`;
                const active = pathname.startsWith(href);
                return (
                  <Link
                    className={active ? "active" : ""}
                    href={href}
                    key={item.segment}
                    title={item.label}
                  >
                    <Icon aria-hidden size={18} />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </>
        ) : null}

        <div className="sidebar-spacer" />
        {user.isInstanceOperator ? (
          <Link className="sidebar-system" href="/settings/connections" title="Подключения">
            <Cable aria-hidden size={18} />
            Подключения
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
