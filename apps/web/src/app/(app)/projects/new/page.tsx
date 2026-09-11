import { Select } from "@pushdocs/ui";
import { ArrowLeft, GitBranch, LockKeyhole } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { ProjectImportForm } from "@/components/project-import-form";
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
        <ProjectImportForm connections={connections} />
      )}
    </div>
  );
}
