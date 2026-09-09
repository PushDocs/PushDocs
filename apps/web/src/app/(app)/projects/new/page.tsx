import { ArrowLeft, GitBranch, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createProjectAction } from "@/app/actions";
import { repository, requireOperator } from "@/lib/server";

export const metadata: Metadata = { title: "Новый проект" };

export default async function NewProjectPage() {
  await requireOperator();
  const connections = await repository().listConnections();
  return (
    <div className="page narrow-page">
      <Link className="back-link" href="/projects">
        <ArrowLeft aria-hidden size={16} />
        Все проекты
      </Link>
      <header className="page-header">
        <div>
          <h1>Подключить проект</h1>
        </div>
      </header>

      {connections.length === 0 ? (
        <section className="notice-panel">
          <LockKeyhole aria-hidden />
          <div>
            <h2>Сначала добавьте Git-подключение</h2>
            <p>Для импорта нужен GitHub token или GitLab access token.</p>
            <Link className="pd-button pd-button--primary" href="/settings/connections">
              Добавить подключение
            </Link>
          </div>
        </section>
      ) : (
        <form action={createProjectAction} className="project-form">
          <div className="form-section">
            <div className="form-section-body">
              <h2>Репозиторий</h2>
              <div className="form-grid">
                <label>
                  Подключение
                  <select name="connectionId" required>
                    {connections.map((connection) => (
                      <option value={connection.id} key={connection.id}>
                        {connection.name} ({connection.kind})
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  URL, ID или путь репозитория
                  <input
                    name="repositoryProviderId"
                    placeholder="https://git.example.test/group/docs"
                    required
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="form-section">
            <div className="form-section-body">
              <h2>Проект документации</h2>
              <div className="form-grid">
                <label>
                  Название
                  <input name="name" placeholder="Документация Sendsay" required />
                </label>
                <label>
                  Короткий адрес
                  <input
                    name="slug"
                    placeholder="sendsay-docs"
                    pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                    required
                  />
                </label>
                <label>
                  Основная ветка
                  <span className="input-with-icon">
                    <GitBranch aria-hidden size={16} />
                    <input name="defaultBranch" placeholder="Основная ветка репозитория" />
                  </span>
                </label>
                <label>
                  Корень Docusaurus
                  <input name="rootPath" defaultValue="." />
                </label>
              </div>
            </div>
          </div>

          <div className="form-actions">
            <Link className="pd-button pd-button--secondary" href="/projects">
              Отмена
            </Link>
            <button className="pd-button pd-button--primary" type="submit">
              Импортировать проект
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
