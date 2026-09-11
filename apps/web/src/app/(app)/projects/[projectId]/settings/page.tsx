import { GitBranch, LockKeyhole, Trash2 } from "lucide-react";
import type { Metadata } from "next";
import { deleteProjectAction, updateProjectAction } from "@/app/actions";
import { ComponentCatalog } from "@/components/component-catalog";
import { componentExamples } from "@/components/component-examples";
import { SettingsNavigation } from "@/components/settings-navigation";
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
  const settings = await repository().getProjectSettings(projectId);
  if (!settings) return <div className="not-found-panel">Проект не найден.</div>;
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
      <SettingsNavigation
        projectId={projectId}
        active="project"
        canManageConnections={user.isInstanceOperator}
      />
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
      {access.role === "admin" ? (
        <section className="project-settings-management">
          <form action={updateProjectAction} className="project-form">
            <input name="projectId" type="hidden" value={projectId} />
            <div className="form-section">
              <div className="form-section-body">
                <h2>Параметры проекта</h2>
                <div className="form-grid">
                  <label>
                    Название
                    <input name="name" defaultValue={settings.name} required />
                  </label>
                  <label>
                    Короткий адрес
                    <input
                      name="slug"
                      defaultValue={settings.slug}
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      required
                    />
                  </label>
                  <label>
                    Основная ветка
                    <input name="defaultBranch" defaultValue={settings.default_branch} required />
                  </label>
                  <label>
                    Корень Docusaurus
                    <input name="rootPath" defaultValue={settings.root_path} />
                  </label>
                </div>
              </div>
            </div>
            <div className="form-actions">
              <button className="pd-button pd-button--primary" type="submit">
                Сохранить изменения
              </button>
            </div>
          </form>
          <details className="danger-zone">
            <summary>Удалить проект</summary>
            <div>
              <h2>Удаление нельзя отменить</h2>
              <p>Черновики, обсуждения, история изменений и загруженные файлы будут удалены.</p>
              <form action={deleteProjectAction}>
                <input name="projectId" type="hidden" value={projectId} />
                <label>
                  Введите <strong>{settings.slug}</strong> для подтверждения
                  <input name="confirmation" required autoComplete="off" />
                </label>
                <button className="pd-button pd-button--danger" type="submit">
                  <Trash2 aria-hidden size={16} />
                  Удалить проект
                </button>
              </form>
            </div>
          </details>
        </section>
      ) : null}
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
