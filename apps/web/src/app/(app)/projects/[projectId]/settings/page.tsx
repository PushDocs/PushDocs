import { Archive, GitBranch, LockKeyhole, Puzzle } from "lucide-react";
import type { Metadata } from "next";
import { createProjectComponentAction } from "@/app/actions";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Настройки проекта" };

function componentCountText(count: number): string {
  const ending = count % 10;
  const lastTwo = count % 100;
  const word =
    ending === 1 && lastTwo !== 11
      ? "компонент"
      : ending >= 2 && ending <= 4 && (lastTwo < 12 || lastTwo > 14)
        ? "компонента"
        : "компонентов";
  return `${count} ${word}`;
}

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
  return (
    <div className="page narrow-page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Настройки проекта</h1>
          <p>Параметры относятся только к этому сайту документации.</p>
        </div>
      </header>
      <section className="setting-sections">
        <article>
          <GitBranch aria-hidden />
          <div>
            <h2>Ветки</h2>
            <p>
              Основная ветка: <code>{project.defaultBranch}</code>. Перед отправкой PushDocs
              проверяет актуальный SHA ветки.
            </p>
          </div>
          <button
            className="pd-button pd-button--secondary"
            disabled
            title="Настройка политики веток появится в следующей версии"
            type="button"
          >
            Настроить
          </button>
        </article>
        <article>
          <Puzzle aria-hidden />
          <div>
            <h2>Компоненты MDX</h2>
            <p>Каталог определяет разрешённые компоненты и поля их свойств.</p>
          </div>
          <span className="active-state">{componentCountText(components.length)}</span>
        </article>
        <article>
          <LockKeyhole aria-hidden />
          <div>
            <h2>Git-подключение</h2>
            <p>
              Секреты доступны только оператору установки. Здесь показывается состояние разрешения.
            </p>
          </div>
          <span className="active-state">Разрешено</span>
        </article>
        <article className="danger-setting">
          <Archive aria-hidden />
          <div>
            <h2>Архивация</h2>
            <p>Проект исчезнет из списка, а его история и общие подключения сохранятся.</p>
          </div>
          <button
            className="pd-button pd-button--danger"
            disabled
            title="Архивация проекта появится в следующей версии"
            type="button"
          >
            Архивировать
          </button>
        </article>
      </section>
      <section className="component-catalog">
        <header>
          <div>
            <p className="eyebrow">Без выполнения кода репозитория</p>
            <h2>Каталог MDX-компонентов</h2>
          </div>
        </header>
        <div className="component-list">
          {components.map((component) => (
            <article key={component.id}>
              <code>{component.name}</code>
              <span>
                <strong>{component.label}</strong>
                <small>{component.description}</small>
              </span>
              <em>{component.source === "detected" ? "Найден" : "Настроен"}</em>
            </article>
          ))}
        </div>
        {access.role === "admin" ? (
          <form action={createProjectComponentAction} className="component-form">
            <input name="projectId" type="hidden" value={projectId} />
            <label>
              Имя компонента
              <input name="name" placeholder="SupportLink" required />
            </label>
            <label>
              Название в редакторе
              <input name="label" placeholder="Ссылка в поддержку" required />
            </label>
            <label className="wide-field">
              Описание
              <input name="description" placeholder="Когда использовать компонент" />
            </label>
            <label className="wide-field">
              Шаблон вставки
              <textarea name="snippet" defaultValue={"<SupportLink>Написать нам</SupportLink>"} />
            </label>
            <button className="pd-button pd-button--primary" type="submit">
              Сохранить компонент
            </button>
          </form>
        ) : null}
      </section>
    </div>
  );
}
