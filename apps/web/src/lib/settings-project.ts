import "server-only";
import { cookies } from "next/headers";
import { actor, application, type CurrentUser } from "./server";

/** Restore only projects this user can still access. */
export async function settingsProjectId(user: CurrentUser): Promise<string | undefined> {
  const projects = await application().listProjects(actor(user));
  const remembered = (await cookies()).get("pushdocs_project")?.value;
  return (
    projects.find((project) => project.id === remembered)?.id ??
    (projects.length === 1 ? projects[0]?.id : undefined)
  );
}

export async function settingsProjectChoices(user: CurrentUser) {
  return application().listProjects(actor(user));
}
