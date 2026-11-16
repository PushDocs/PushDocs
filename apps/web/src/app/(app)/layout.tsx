import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { actor, application, repository, requireUser } from "@/lib/server";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const projects = await application().listProjects(actor(user));
  const contexts = await Promise.all(
    projects.map(async (project) => {
      const [branches, attention] = await Promise.all([
        repository().listBranchSummaries(project.id),
        repository().listBranchesNeedingAttention(project.id),
      ]);
      return { id: project.id, branches, attention };
    }),
  );
  const branchesByProject = Object.fromEntries(contexts.map((item) => [item.id, item.branches]));
  const branchAttentionByProject = Object.fromEntries(
    contexts.map((item) => [item.id, item.attention]),
  );
  return (
    <AppShell
      projects={projects}
      branchesByProject={branchesByProject}
      branchAttentionByProject={branchAttentionByProject}
      user={user}
    >
      {children}
    </AppShell>
  );
}
