import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { actor, application, requireUser } from "@/lib/server";

export default async function ApplicationLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const projects = await application().listProjects(actor(user));
  return (
    <AppShell projects={projects} user={user}>
      {children}
    </AppShell>
  );
}
