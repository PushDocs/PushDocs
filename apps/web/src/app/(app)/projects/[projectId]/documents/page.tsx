import { FileText, GitBranch, MessageSquare, Plus, Search } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { createCommentAction, createDocumentAction, synchronizeBranchAction } from "@/app/actions";
import { BranchPicker } from "@/components/branch-picker";
import { DocumentEditor } from "@/components/document-editor";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Документы" };

export default async function DocumentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; new?: string; path?: string; q?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const projects = await application().listProjects(actor(user));
  const project = projects.find((item) => item.id === projectId);
  if (!project) return <div className="not-found-panel">Проект не найден или доступ отозван.</div>;
  const query = await searchParams;
  const branch = query.branch ?? project.defaultBranch;
  const access = await repository().requireProjectAccess(user.id, projectId);
  const branches = await repository().listBranches(projectId);
  const components = await repository().listProjectComponents(projectId);

  if (!branches.some((item) => item.full_ref === branch)) {
    return (
      <div className="project-screen">
        <header className="project-topbar">
          <div>
            <span>{project.name}</span>
            <strong>Документы</strong>
          </div>
          <span className="branch-placeholder">
            <GitBranch aria-hidden size={15} />
            {branch}
          </span>
        </header>
        <section className="sync-state">
          <span className="sync-orbit" />
          <p className="eyebrow">Импорт запланирован</p>
          <h1>Читаем структуру Docusaurus</h1>
          <p>
            Worker создаст контекст основной ветки и загрузит Markdown и MDX. Страница обновится
            после завершения задачи.
          </p>
        </section>
      </div>
    );
  }

  const availableDocuments = await application().listDocuments(actor(user), projectId, branch);
  const documentQuery = query.q?.trim().toLocaleLowerCase("ru") ?? "";
  const documents = documentQuery
    ? availableDocuments.filter((item) =>
        `${item.title} ${item.path}`.toLocaleLowerCase("ru").includes(documentQuery),
      )
    : availableDocuments;
  const creating = query.new === "1" && access.role !== "reader";
  const selectedPath =
    !creating && query.path && availableDocuments.some((document) => document.path === query.path)
      ? query.path
      : documents[0]?.path;
  const document = selectedPath
    ? await repository().getDocument(projectId, branch, selectedPath)
    : undefined;
  const comments = selectedPath
    ? await repository().listComments(projectId, branch, selectedPath)
    : [];

  return (
    <div className="project-screen editor-screen">
      <header className="project-topbar">
        <div>
          <span>{project.name}</span>
          <strong>{document?.title ?? "Документы"}</strong>
        </div>
        <div className="topbar-actions">
          <BranchPicker branches={branches} value={branch} />
          <span className="locale-switch">RU</span>
          <Link
            className="pd-button pd-button--primary"
            href={`/projects/${projectId}/changes?branch=${encodeURIComponent(branch)}`}
          >
            К изменениям
          </Link>
        </div>
      </header>

      <div className="editor-layout">
        <aside className="document-tree">
          <div className="tree-tools">
            <form className="search-field compact">
              <Search aria-hidden size={15} />
              <input name="branch" type="hidden" value={branch} />
              <input
                aria-label="Найти документ"
                defaultValue={documentQuery}
                name="q"
                placeholder="Найти документ"
              />
            </form>
            <Link
              className="tree-add"
              href={`?branch=${encodeURIComponent(branch)}&new=1`}
              aria-label="Создать документ"
            >
              <Plus aria-hidden size={17} />
            </Link>
          </div>
          <div className="tree-caption">
            <span>Документы</span>
            <small>{documents.length}</small>
          </div>
          <nav className="tree-list" aria-label="Документы">
            {documents.map((item) => (
              <Link
                className={item.path === selectedPath ? "active" : ""}
                href={`?branch=${encodeURIComponent(branch)}&path=${encodeURIComponent(item.path)}`}
                key={item.path}
              >
                <FileText aria-hidden size={16} />
                <span>
                  {item.title}
                  <small>{item.path}</small>
                </span>
                {item.status !== "clean" ? (
                  <i>
                    <span className="sr-only">Изменён</span>
                  </i>
                ) : null}
              </Link>
            ))}
          </nav>
        </aside>

        {creating ? (
          <section className="new-document-panel">
            <div>
              <p className="eyebrow">Новый файл в {branch}</p>
              <h2>Создать документ</h2>
              <p>Файл появится в текущем наборе изменений и попадёт в Git одним коммитом.</p>
            </div>
            <form action={createDocumentAction}>
              <input name="projectId" type="hidden" value={projectId} />
              <input name="branch" type="hidden" value={branch} />
              <label>
                Заголовок
                <input name="title" placeholder="Новый раздел" required />
              </label>
              <label>
                Путь в проекте Docusaurus
                <input name="path" defaultValue="docs/new-document.mdx" required />
              </label>
              <div>
                <Link
                  className="pd-button pd-button--secondary"
                  href={`?branch=${encodeURIComponent(branch)}`}
                >
                  Отмена
                </Link>
                <button className="pd-button pd-button--primary" type="submit">
                  Создать документ
                </button>
              </div>
            </form>
          </section>
        ) : documentQuery && documents.length === 0 ? (
          <section className="empty-document">
            <Search aria-hidden />
            <h2>Документы не найдены</h2>
            <p>Измените строку поиска и нажмите Enter.</p>
            <Link
              className="pd-button pd-button--secondary"
              href={`?branch=${encodeURIComponent(branch)}`}
            >
              Сбросить поиск
            </Link>
          </section>
        ) : document ? (
          <DocumentEditor
            baseCommitSha={document.head_commit_sha}
            branch={branch}
            initialContent={document.draft_content ?? document.source_content}
            initialRevision={document.draft_revision ?? 0}
            key={`${branch}:${document.path}:${document.head_commit_sha}`}
            path={document.path}
            projectId={projectId}
            readOnly={access.role === "reader" || document.change_set_status === "submitting"}
            components={components}
          />
        ) : (
          <section className="empty-document">
            <FileText aria-hidden />
            <h2>В ветке нет документов</h2>
            <p>Ветка ещё не импортирована или в ней нет Markdown и MDX.</p>
            <form action={synchronizeBranchAction}>
              <input name="projectId" type="hidden" value={projectId} />
              <input name="branch" type="hidden" value={branch} />
              <button className="pd-button pd-button--primary" type="submit">
                Импортировать ветку
              </button>
            </form>
          </section>
        )}

        <aside className="comments-panel">
          <header>
            <div>
              <MessageSquare aria-hidden size={17} />
              <strong>Комментарии</strong>
            </div>
            <span>{comments.length}</span>
          </header>
          <div className="comments-list">
            {comments.length === 0 ? (
              <div className="comments-empty">
                <MessageSquare aria-hidden size={24} />
                <p>Обсуждений пока нет.</p>
                <span>Читатели тоже могут оставлять комментарии.</span>
              </div>
            ) : (
              comments.map((comment) => (
                <article className="comment" key={comment.id}>
                  {comment.anchor_quote ? <blockquote>{comment.anchor_quote}</blockquote> : null}
                  <div className="comment-author">
                    <span className="avatar small">
                      {comment.author_name.slice(0, 1).toUpperCase()}
                    </span>
                    <strong>{comment.author_name}</strong>
                    <time>{new Date(comment.created_at).toLocaleString("ru")}</time>
                  </div>
                  <p>{comment.body}</p>
                </article>
              ))
            )}
          </div>
          {document ? (
            <form action={createCommentAction} className="comment-form" id="new-comment">
              <input name="projectId" type="hidden" value={projectId} />
              <input name="branch" type="hidden" value={branch} />
              <input name="documentPath" type="hidden" value={document.path} />
              <input name="anchorQuote" type="hidden" value="" />
              <label>
                <span className="sr-only">Новый комментарий</span>
                <textarea name="body" placeholder="Оставить комментарий…" required />
              </label>
              <button className="pd-button pd-button--primary" type="submit">
                Отправить
              </button>
            </form>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
