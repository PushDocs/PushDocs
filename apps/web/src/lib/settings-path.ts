export type SettingsSection = "project" | "members" | "profile" | "editor" | "mcp" | "connections";

export function settingsPath(section: SettingsSection, projectId?: string) {
  const base = projectId ? `/projects/${projectId}/settings` : "/settings";
  return section === "project" ? base : `${base}/${section}`;
}
