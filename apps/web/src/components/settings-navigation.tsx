import Link from "next/link";

export function SettingsNavigation({
  projectId,
  active,
  canManageConnections,
}: {
  projectId?: string;
  active: "project" | "members" | "connections" | "profile";
  canManageConnections: boolean;
}) {
  const base = projectId ? `/projects/${projectId}/settings` : "/settings";
  return (
    <nav className="settings-navigation" aria-label="Разделы настроек">
      {projectId ? (
        <>
          <Link href={base} aria-current={active === "project" ? "page" : undefined}>
            Проект
          </Link>
          <Link href={`${base}/members`} aria-current={active === "members" ? "page" : undefined}>
            Пользователи
          </Link>
        </>
      ) : null}
      <Link href="/settings/profile" aria-current={active === "profile" ? "page" : undefined}>
        Профиль
      </Link>
      {canManageConnections ? (
        <Link
          href={`${base}/connections`}
          aria-current={active === "connections" ? "page" : undefined}
        >
          Подключения
        </Link>
      ) : null}
    </nav>
  );
}
