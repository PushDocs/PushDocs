import Link from "next/link";

export function SettingsProjectPicker({
  projects,
}: {
  projects: Array<{ id: string; name: string }>;
}) {
  if (!projects.length) return null;
  return (
    <details className="settings-project-picker">
      <summary>Настройки проекта и участники</summary>
      <nav aria-label="Выберите проект">
        {projects.map((project) => (
          <Link key={project.id} href={`/projects/${project.id}/settings`}>
            {project.name}
          </Link>
        ))}
      </nav>
    </details>
  );
}
