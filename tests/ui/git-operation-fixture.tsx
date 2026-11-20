import { ArrowRight, FileText, Play } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../../apps/web/src/components/app-shell";
import { BranchOperations } from "../../apps/web/src/components/branch-operations";
import { GitOperation } from "../../apps/web/src/components/git-operation";

export function BranchAttentionFixture() {
  return (
    <AppShell
      projects={[
        {
          id: "project",
          name: "sendsay-docs",
          slug: "sendsay-docs",
          defaultBranch: "stable",
          provider: "gitlab",
          providerLabel: "GitLab",
          role: "editor",
          syncStatus: "current",
          openChangeRequests: 2,
          updatedAt: "2026-11-13T10:00:00Z",
        },
      ]}
      user={{
        id: "user",
        displayName: "Anna",
        email: "anna@example.test",
        isInstanceOperator: false,
      }}
      branchesByProject={{ project: [{ full_ref: "stable" }, { full_ref: "docs/task" }] }}
      branchAttentionByProject={{ project: ["docs/task"] }}
    >
      <main className="page">
        <h1>Документы</h1>
        <article>
          <h2>Подключение домена</h2>
          <p>Содержимое документа доступно без предупреждающего баннера.</p>
        </article>
      </main>
    </AppShell>
  );
}

export function GitOperationFixture() {
  const [tab, setTab] = useState("documents");
  const merge = new URLSearchParams(window.location.search).has("merge");
  if (new URLSearchParams(window.location.search).has("create-review"))
    return (
      <main className="page changes-page">
        <section className="empty-state">
          <FileText aria-hidden />
          <h2>Все изменения отправлены</h2>
          <GitOperation projectId="project" branch="docs/task" createReview reviewLabel="MR">
            <a className="pd-button pd-button--secondary" href="#documents">
              Открыть документы
            </a>
          </GitOperation>
        </section>
      </main>
    );
  return (
    <>
      <nav aria-label="Разделы проекта">
        <button type="button" onClick={() => setTab("documents")}>
          Документы
        </button>
        <button type="button" onClick={() => setTab("reviews")}>
          MR
        </button>
        <button type="button" onClick={() => setTab("other")}>
          Другой раздел
        </button>
      </nav>
      {tab === "documents" ? (
        <div className="workbench">
          <header className="wb-header">
            <div>
              <small>Проект</small>
              <h1>Документы</h1>
            </div>
            <div className="wb-actions">
              <BranchOperations
                projectId="project"
                branch={merge ? "docs/task" : "stable"}
                defaultBranch="stable"
                canMerge={merge}
                disabled={false}
                beforeStart={async () => true}
                onComplete={async () => {}}
              />
              <button type="button" className="live-preview-start">
                <Play size={16} aria-hidden /> Предпросмотр
              </button>
              <a className="wb-primary" href="#changes">
                К изменениям (5) <ArrowRight size={16} aria-hidden />
              </a>
            </div>
          </header>
          <div>Файлы проекта</div>
        </div>
      ) : tab === "reviews" ? (
        <main className="page reviews-page">
          <h1>MR</h1>
          <div className="review-sync">
            <GitOperation projectId="project" branch="stable" reviewsOnly reviewLabel="MR" />
          </div>
        </main>
      ) : (
        <main>Настройки проекта</main>
      )}
    </>
  );
}
