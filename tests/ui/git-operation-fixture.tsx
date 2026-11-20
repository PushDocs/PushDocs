import { ArrowRight, FileText, Play } from "lucide-react";
import { useState } from "react";
import { AppShell } from "../../apps/web/src/components/app-shell";
import { BranchOperations } from "../../apps/web/src/components/branch-operations";
import { CompletedReviewStatus } from "../../apps/web/src/components/completed-review-status";
import { GitOperation } from "../../apps/web/src/components/git-operation";
import { ProjectContext } from "../../apps/web/src/components/project-context";
import { ReviewMissingBranchNotice } from "../../apps/web/src/components/review-branch-context";
import type { BranchReview } from "../../apps/web/src/lib/branch-review";

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
  const completedState = new URLSearchParams(window.location.search).get("completed-review");
  if (completedState === "merged" || completedState === "closed") {
    const review: BranchReview = {
      external_id: "818",
      source_branch: "docs/818-sendsay-mcp",
      target_branch: "stable",
      state: completedState,
      title: "Документация Sendsay MCP",
      provider_url: "https://git.example/review/818",
      source_branch_is_local: true,
    };
    const reviewsPage = new URLSearchParams(window.location.search).has("review-status");
    return (
      <main className={`page ${reviewsPage ? "reviews-page" : "changes-page"}`}>
        <ProjectContext projectId="project" branch={review.source_branch} />
        <h1>{reviewsPage ? "MR" : "Изменения в ветке"}</h1>
        {reviewsPage ? (
          <ReviewMissingBranchNotice
            projectId="project"
            defaultBranch="stable"
            branchReviews={[review]}
            reviewLabel="MR"
          />
        ) : (
          <>
            <GitOperation
              projectId="project"
              branch={review.source_branch}
              headSha="installed"
              defaultBranch="stable"
            />
            <CompletedReviewStatus
              state={completedState}
              title={review.title}
              targetBranch={review.target_branch}
              url={review.provider_url}
              reviewLabel="MR"
            >
              <a className="pd-button pd-button--secondary" href="#documents">
                Открыть документы
              </a>
            </CompletedReviewStatus>
          </>
        )}
      </main>
    );
  }
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
                headSha="installed"
                remoteHeadSha="remote"
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
