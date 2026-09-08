import type { Metadata } from "next";
import Link from "next/link";
import { MediaLibrary } from "@/components/media-library";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Файлы" };

export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<{ branch?: string; document?: string }>;
}) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  await repository().requireProjectAccess(user.id, projectId);
  const query = await searchParams;
  const branch = query.branch ?? project.defaultBranch;
  const document = query.document ?? "docs/intro.md";
  const branches = await repository().listBranches(projectId);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Файлы</h1>
          <p>Медиа из Git и черновиков выбранной ветки. Изменения отправляются одним коммитом.</p>
        </div>
        <Link
          href={`/projects/${projectId}/documents?${new URLSearchParams({ branch, path: document })}`}
        >
          Вернуться к документу
        </Link>
      </header>
      <form className="media-toolbar">
        <label>
          Ветка
          <select name="branch" defaultValue={branch}>
            {branches.map((item) => (
              <option key={item.id} value={item.full_ref}>
                {item.full_ref}
              </option>
            ))}
          </select>
        </label>
        <label>
          Документ для выбора каталога
          <input name="document" defaultValue={document} />
        </label>
        <button className="pd-button" type="submit">
          Открыть
        </button>
      </form>
      <MediaLibrary
        key={`${branch}:${document}`}
        projectId={projectId}
        branch={branch}
        document={document}
      />
    </div>
  );
}
