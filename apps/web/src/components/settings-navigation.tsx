import Link from "next/link";
import { type SettingsSection, settingsPath } from "../lib/settings-path";

export function SettingsNavigation({
  projectId,
  active,
  canManageConnections,
}: {
  projectId?: string;
  active: SettingsSection;
  canManageConnections: boolean;
}) {
  return (
    <nav className="settings-navigation" aria-label="Разделы настроек">
      {projectId ? (
        <>
          <Link
            href={settingsPath("project", projectId)}
            aria-current={active === "project" ? "page" : undefined}
          >
            Проект
          </Link>
          <Link
            href={settingsPath("members", projectId)}
            aria-current={active === "members" ? "page" : undefined}
          >
            Участники
          </Link>
        </>
      ) : null}
      <Link
        href={settingsPath("profile", projectId)}
        aria-current={active === "profile" ? "page" : undefined}
      >
        Мой профиль
      </Link>
      <Link
        href={settingsPath("editor", projectId)}
        aria-current={active === "editor" ? "page" : undefined}
      >
        Редактор
      </Link>
      <Link
        href={settingsPath("mcp", projectId)}
        aria-current={active === "mcp" ? "page" : undefined}
      >
        MCP
      </Link>
      {canManageConnections ? (
        <Link
          href={settingsPath("connections", projectId)}
          aria-current={active === "connections" ? "page" : undefined}
        >
          Git-подключения
        </Link>
      ) : null}
    </nav>
  );
}
