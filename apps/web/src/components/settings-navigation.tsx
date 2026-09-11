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
            Участники
          </Link>
        </>
      ) : null}
      <Link href={`${base}/profile`} aria-current={active === "profile" ? "page" : undefined}>
        Мой профиль
      </Link>
      {canManageConnections ? (
        <Link
          href={`${base}/connections`}
          aria-current={active === "connections" ? "page" : undefined}
        >
          Git-подключения
        </Link>
      ) : null}
    </nav>
  );
}
