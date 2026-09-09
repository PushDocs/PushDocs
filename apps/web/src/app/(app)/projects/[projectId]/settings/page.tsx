import { GitBranch, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import { ComponentCatalog } from "@/components/component-catalog";
import { componentExamples } from "@/components/component-examples";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Настройки проекта" };

export default async function ProjectSettingsPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const access = await repository().requireProjectAccess(user.id, projectId);
  const components = await repository().listProjectComponents(projectId);
  const branches = await repository().listBranches(projectId);
  const state = branches.some((item) => item.full_ref === project.defaultBranch)
    ? await repository().listWorkingFiles(projectId, project.defaultBranch)
    : undefined;
  const examples = componentExamples(
    components,
    state?.files.filter((file) => file.status !== "delete") ?? [],
  );
  return (
    <div className="page narrow-page">
      <header className="page-header">
        <div>
          <h1>Настройки проекта</h1>
        </div>
      </header>
      <section className="setting-sections">
        <article>
          <GitBranch aria-hidden />
          <div>
            <h2>Основная ветка</h2>
            <p>
              <code>{project.defaultBranch}</code>
            </p>
          </div>
        </article>
        <article>
          <LockKeyhole aria-hidden />
          <div>
            <h2>Git-подключение</h2>
            <p>{project.providerLabel}</p>
          </div>
        </article>
      </section>
      <ComponentCatalog
        components={components}
        examples={examples}
        projectId={projectId}
        branch={project.defaultBranch}
        repositoryPaths={state?.branch.repository_paths ?? []}
        canEdit={access.role === "admin"}
      />
    </div>
  );
}
