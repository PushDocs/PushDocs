import { FileImage, GitBranch, Upload } from "lucide-react";
import type { Metadata } from "next";
import { uploadAttachmentAction } from "@/app/actions";
import { actor, application, repository, requireUser } from "@/lib/server";

export const metadata: Metadata = { title: "Файлы" };

export default async function FilesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const user = await requireUser();
  const { projectId } = await params;
  const project = (await application().listProjects(actor(user))).find(
    (item) => item.id === projectId,
  );
  if (!project) return <div className="not-found-panel">Проект не найден.</div>;
  const access = await repository().requireProjectAccess(user.id, projectId);
  const attachments = await repository().listAttachments(projectId);
  return (
    <div className="page">
      <header className="page-header">
        <div>
          <p className="eyebrow">{project.name}</p>
          <h1>Файлы</h1>
          <p>Изображения и документы отправляются в Git вместе с набором изменений ветки.</p>
        </div>
      </header>
      {access.role !== "reader" ? (
        <form action={uploadAttachmentAction} className="upload-panel">
          <span className="upload-icon">
            <Upload aria-hidden />
          </span>
          <div>
            <strong>Загрузить файл</strong>
            <p>PNG, JPEG, WebP, GIF, SVG или PDF до 10 МБ.</p>
          </div>
          <input name="projectId" type="hidden" value={projectId} />
          <label>
            <span className="sr-only">Ветка</span>
            <span className="input-with-icon">
              <GitBranch aria-hidden size={15} />
              <input name="branch" defaultValue={project.defaultBranch} required />
            </span>
          </label>
          <label className="file-input">
            Выбрать файл
            <input name="file" type="file" accept="image/*,.pdf" required />
          </label>
          <button className="pd-button pd-button--primary" type="submit">
            Загрузить
          </button>
        </form>
      ) : null}
      <section className="asset-grid">
        {attachments.length === 0 ? (
          <div className="empty-state compact-empty">
            <FileImage aria-hidden />
            <h2>Файлов пока нет</h2>
            <p>Загруженные файлы будут видны здесь до отправки в Git.</p>
          </div>
        ) : (
          attachments.map((attachment) => (
            <article className="asset-card" key={attachment.id}>
              <span className="asset-preview">
                <FileImage aria-hidden />
              </span>
              <div>
                <strong>{attachment.original_name}</strong>
                <small>
                  {attachment.branch} · {(Number(attachment.size_bytes) / 1024).toFixed(1)} КБ
                </small>
              </div>
              <span className="active-state">
                {attachment.status === "ready" ? "Готов" : attachment.status}
              </span>
            </article>
          ))
        )}
      </section>
    </div>
  );
}
