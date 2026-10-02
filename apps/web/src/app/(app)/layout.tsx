import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { actor, application, repository, requireUser } from "@/lib/server";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const projects = await application().listProjects(actor(user));
  const branchesByProject = Object.fromEntries(
    await Promise.all(
      projects.map(
        async (project) => [project.id, await repository().listBranches(project.id)] as const,
      ),
    ),
  );
  return (
    <AppShell projects={projects} branchesByProject={branchesByProject} user={user}>
      {children}
    </AppShell>
  );
}
