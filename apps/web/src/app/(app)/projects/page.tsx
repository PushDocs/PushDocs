import { Status } from "@pushdocs/ui";
import { ArrowRight, CircleAlert, GitBranch, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { actor, application, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Проекты" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const user = await requireUser();
  const query = (await searchParams).q?.trim().toLocaleLowerCase("ru") ?? "";
  const availableProjects = await application().listProjects(actor(user));
  const projects = query
    ? availableProjects.filter((project) =>
        [project.name, project.slug, project.providerLabel].some((value) =>
          value.toLocaleLowerCase("ru").includes(query),
        ),
      )
    : availableProjects;
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">Установка PushDocs</p>
          <h1>Проекты</h1>
          <p>Документация, к которой у вас есть доступ.</p>
        </div>
        {user.isInstanceOperator ? (
          <Link className="pd-button pd-button--primary" href="/projects/new">
            <Plus aria-hidden size={17} />
            Подключить проект
          </Link>
        ) : null}
      </header>

      <div className="project-tools">
        <form className="search-field">
          <Search aria-hidden size={17} />
          <input
            aria-label="Найти проект"
            defaultValue={query}
            name="q"
            placeholder="Найти проект"
          />
        </form>
        <span className="project-count">
          {projects.length} {projects.length === 1 ? "доступен" : "доступно"}
        </span>
      </div>

      {availableProjects.length === 0 ? (
        <section className="empty-state">
          <span className="empty-icon">
            <GitBranch aria-hidden />
          </span>
          <h2>Пока нет доступных проектов</h2>
          <p>
            {user.isInstanceOperator
              ? "Подключите репозиторий GitHub или GitLab, чтобы импортировать документацию."
              : "Администратор проекта должен пригласить вас с подходящей ролью."}
          </p>
          {user.isInstanceOperator ? (
            <Link className="pd-button pd-button--primary" href="/projects/new">
              Подключить первый проект
            </Link>
          ) : null}
        </section>
      ) : projects.length === 0 ? (
        <section className="empty-state compact-empty">
          <Search aria-hidden />
          <h2>Проекты не найдены</h2>
          <p>Измените строку поиска и нажмите Enter.</p>
          <Link className="pd-button pd-button--secondary" href="/projects">
            Сбросить поиск
          </Link>
        </section>
      ) : (
        <section className="project-list" aria-label="Проекты">
          <div className="project-list-head">
            <span>Проект</span>
            <span>Git-провайдер</span>
            <span>Основная ветка</span>
            <span>Состояние</span>
            <span />
          </div>
          {projects.map((project) => (
            <Link
              className="project-row"
              href={`/projects/${project.id}/documents`}
              key={project.id}
            >
              <span className="project-title-cell">
                <span className="project-monogram large">
                  {project.name.slice(0, 1).toUpperCase()}
                </span>
                <span>
                  <strong>{project.name}</strong>
                  <small>{project.slug}</small>
                </span>
              </span>
              <span>
                {project.provider === "gitlab" ? "GitLab" : "GitHub"}
                <small>{project.providerLabel}</small>
              </span>
              <span className="branch-cell">
                <GitBranch aria-hidden size={15} />
                {project.defaultBranch}
              </span>
              <span>
                {project.syncStatus === "attention" ? (
                  <Status tone="warning">
                    <CircleAlert aria-hidden size={13} />
                    Требует внимания
                  </Status>
                ) : (
                  <Status tone="success">Синхронизирован</Status>
                )}
              </span>
              <ArrowRight className="row-arrow" aria-hidden size={18} />
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}
