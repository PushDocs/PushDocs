"use client";

import type { ProjectSummary } from "@pushdocs/contracts";
import { SearchableSelect } from "@pushdocs/ui";
import {
  BookOpenText,
  ChevronDown,
  FolderGit2,
  GitBranch,
  GitPullRequest,
  LogOut,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings,
  SlidersHorizontal,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { logoutAction } from "@/app/actions";
import type { CurrentUser } from "@/lib/server";
import { documentHref, readProjectBranch, rememberProjectBranch } from "./project-context";
import { PushDocsLogo } from "./pushdocs-logo";
import { RealtimeRefresh } from "./realtime-refresh";

const projectNavigation = [
  { icon: BookOpenText, label: "Документы", segment: "documents" },
  { icon: SlidersHorizontal, label: "Изменения", segment: "changes" },
  { icon: Monitor, label: "Предпросмотр", segment: "previews" },
  { icon: GitPullRequest, label: "PR / MR", segment: "reviews" },
  { icon: Settings, label: "Настройки", segment: "settings" },
];

export function AppShell({
  children,
  projects,
  branchesByProject = {},
  user,
}: {
  children: ReactNode;
  projects: ProjectSummary[];
  branchesByProject?: Record<string, Array<{ full_ref: string }>>;
  user: CurrentUser;
}) {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const projectSwitcherRef = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const router = useRouter();
  const match = pathname.match(/^\/projects\/([^/]+)/);
  const projectId = match?.[1];
  const activeProject = projects.find((project) => project.id === projectId);

  useEffect(() => {
    if (activeProject) {
      // biome-ignore lint/suspicious/noDocumentCookie: Keep project context available to server routes and browsers without Cookie Store.
      document.cookie = `pushdocs_project=${encodeURIComponent(activeProject.id)}; Path=/; SameSite=Lax`;
    }
  }, [activeProject]);

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
    const update = (event?: Event) => {
      if (!activeProject || !pathname.startsWith("/projects/")) return;
      const query = new URLSearchParams(window.location.search);
      setCurrentBranch(
        (event?.type !== "pushdocs:context" && /\/(documents|changes)$/.test(pathname)
          ? query.get("branch")
          : null) || readProjectBranch(activeProject.id, activeProject.defaultBranch),
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
                    </span>
                  </Link>
                ))}
              </nav>
            </details>
            <div
              className="sidebar-branch"
              title={`Текущая ветка: ${currentBranch || activeProject.defaultBranch}`}
            >
              <small>Текущая ветка</small>
              <SearchableSelect
                className="sidebar-branch-picker"
                label="Выбрать текущую ветку"
                leadingIcon={<GitBranch aria-hidden size={16} />}
                value={currentBranch || activeProject.defaultBranch}
                fallbackLabel={currentBranch || activeProject.defaultBranch}
                options={(branchesByProject[activeProject.id] ?? []).map((item) => ({
                  label: item.full_ref,
                  value: item.full_ref,
                }))}
                searchLabel="Поиск по веткам"
                searchPlaceholder="Найти ветку…"
                emptyText="Ветки не найдены"
                onValueChange={(branch) => {
                  if (branch === (currentBranch || activeProject.defaultBranch)) return;
                  const href = pathname.endsWith("/changes")
                    ? `/projects/${activeProject.id}/changes?${new URLSearchParams({ branch })}`
                    : documentHref(activeProject.id, branch);
                  const event = new CustomEvent("pushdocs:branch-switch", {
                    cancelable: true,
                    detail: { projectId: activeProject.id, branch, href },
                  });
                  if (window.dispatchEvent(event)) {
                    rememberProjectBranch(activeProject.id, branch);
                    router.push(href);
                    router.refresh();
                  }
                }}
              />
              <button
                className="sidebar-new-branch"
                type="button"
                title="Новая ветка"
                aria-label="Новая ветка"
                disabled={
                  activeProject.role === "reader" ||
                  !(branchesByProject[activeProject.id] ?? []).some(
                    (item) => item.full_ref === (currentBranch || activeProject.defaultBranch),
                  )
                }
                onClick={() => {
                  const event = new CustomEvent("pushdocs:branch-create", {
                    cancelable: true,
                    detail: { projectId: activeProject.id },
                  });
                  if (window.dispatchEvent(event)) {
                    const href = new URL(
                      documentHref(activeProject.id, currentBranch || activeProject.defaultBranch),
                      window.location.origin,
                    );
                    href.searchParams.set("panel", "branch");
                    router.push(href.pathname + href.search);
                  }
                }}
              >
                <Plus aria-hidden size={16} />
                <span>Новая ветка</span>
              </button>
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
        {!activeProject ? (
          <Link
            className={
              pathname.startsWith("/settings") ? "sidebar-system active" : "sidebar-system"
            }
            href={user.isInstanceOperator ? "/settings/connections" : "/settings/profile"}
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
            <small>{user.isInstanceOperator ? "Владелец" : user.email}</small>
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
