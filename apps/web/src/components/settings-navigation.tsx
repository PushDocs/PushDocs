import Link from "next/link";

export function SettingsNavigation({
  projectId,
  active,
  canManageConnections,
}: {
  projectId: string;
  active: "project" | "members" | "connections";
  canManageConnections: boolean;
}) {
  const base = `/projects/${projectId}/settings`;
  return (
    <nav className="settings-navigation" aria-label="Разделы настроек">
      <Link href={base} aria-current={active === "project" ? "page" : undefined}>
        Проект
      </Link>
      <Link href={`${base}/members`} aria-current={active === "members" ? "page" : undefined}>
        Участники
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
