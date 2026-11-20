import {
  BranchUpdateStrategy,
  hasBranchConflicts,
  MediaInsertionMode,
  needsBranchUpdate,
} from "@pushdocs/contracts";
import { ExternalLink, GitPullRequest, X } from "lucide-react";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { AssetVideo } from "../../apps/web/src/components/asset-video";
import { BranchConflictNotice } from "../../apps/web/src/components/branch-conflicts";
import { CopyInvitation } from "../../apps/web/src/components/copy-invitation";
import { DiffViewer } from "../../apps/web/src/components/diff-viewer";
import { FileComments, FileCommentsButton } from "../../apps/web/src/components/file-comments";
import { FilePicker } from "../../apps/web/src/components/file-picker";
import { LivePreviewButton } from "../../apps/web/src/components/live-preview-button";
import { MediaLibrary } from "../../apps/web/src/components/media-library";
import { QuickOpen } from "../../apps/web/src/components/quick-open";
import { ReviewBranchAction } from "../../apps/web/src/components/review-branch-action";
import {
  ReviewBranchList,
  ReviewBranchSwitch,
  ReviewMissingBranchNotice,
} from "../../apps/web/src/components/review-branch-context";
import { ReviewBranchUpdate } from "../../apps/web/src/components/review-branch-update";
import {
  ReviewInformation,
  ReviewReadiness,
} from "../../apps/web/src/components/review-information";
import { SettingsModal, useSettingsModal } from "../../apps/web/src/components/settings-modal";
import { SubmitChanges } from "../../apps/web/src/components/submit-changes";
import { useFileComments } from "../../apps/web/src/components/use-file-comments";
import { Button, SearchableSelect, Select, Status } from "../../packages/ui/src";
import { resolvedBranchUpdatePolicy } from "../fixtures/branch-update-policy";
import { BranchImportFixture } from "./branch-import-fixture";
import { ChangeReviewFixture } from "./change-review-fixture";
import { CollaborationFixture } from "./collaboration-fixture";
import { EditorSettingsFixture, SettingsContextFixture } from "./editor-settings-fixture";
import { BranchAttentionFixture, GitOperationFixture } from "./git-operation-fixture";
import { PathCompletionsFixture } from "./path-completions-fixture";
import { SidebarBranchPickerFixture } from "./sidebar-branch-picker-fixture";
import { WorkbenchScrollFixture } from "./workbench-scroll-fixture";
import { workbenchSearchFixture } from "./workbench-search-data";
import { WorkbenchSearchFixture } from "./workbench-search-fixture";
import "../../packages/ui/src/styles.css";
import "../../apps/web/src/app/globals.css";
import "../../apps/web/src/app/workbench.css";

function Form() {
  const modal = useSettingsModal();
  return (
    <form
      className="connection-edit-form"
      onSubmit={(event) => {
        event.preventDefault();
        modal.setPending(true);
      }}
    >
      <label>
        Название
        <input name="name" defaultValue="Sendsay" placeholder="Название подключения" />
      </label>
      <Select
        name="kind"
        label="Провайдер"
        defaultValue="gitlab"
        options={[
          { value: "gitlab", label: "GitLab" },
          { value: "github", label: "GitHub" },
        ]}
      />
      <button type="submit" className="pd-button pd-button--primary">
        Сохранить
      </button>
    </form>
  );
}
function RoleForm() {
  const [role, setRole] = useState("admin");
  return (
    <form className="critical-fields">
      {new URLSearchParams(window.location.search).has("tall") ? (
        <div>
          {Array.from({ length: 30 }, (_, index) => `Настройки подключения ${index + 1}`).map(
            (text) => (
              <p key={text}>{text}</p>
            ),
          )}
        </div>
      ) : null}
      <Select
        name="role"
        label="Доступ к проекту"
        value={role}
        onValueChange={setRole}
        options={[
          { value: "admin", label: "Администратор" },
          { value: "editor", label: "Редактор" },
          { value: "reader", label: "Читатель" },
        ]}
      />
      <div className="settings-modal-actions">
        <button type="button" className="pd-button pd-button--primary">
          Сохранить роль
        </button>
        <button type="button" className="pd-button pd-button--danger">
          Отозвать доступ
        </button>
      </div>
    </form>
  );
}

function SettingsFixture() {
  const [open, setOpen] = useState(false);
  return (
    <main className="page">
      <button type="button" onClick={() => setOpen(true)}>
        Открыть форму
      </button>
      <button type="button">За пределами окна</button>
      {open ? (
        <SettingsModal
          title={new URLSearchParams(window.location.search).get("title") ?? "Подключение"}
          onClose={() => setOpen(false)}
        >
          {new URLSearchParams(window.location.search).has("roles") ? <RoleForm /> : <Form />}
        </SettingsModal>
      ) : null}
    </main>
  );
}

function CommentsFixture() {
  const [open, setOpen] = useState(false);
  const state = useFileComments({
    projectId: "project",
    branch: "main",
    path: "docs/a.md",
    active: open,
  });
  return (
    <main className="page">
      <div className="wb-toolbar">
        <FileCommentsButton
          open={open}
          unreadCount={state.unreadCount}
          onToggle={() => setOpen(!open)}
        />
      </div>
      <aside id="wb-comment-panel" hidden={!open}>
        <FileComments
          projectId="project"
          branch="main"
          path="docs/a.md"
          active={open}
          state={state}
        />
      </aside>
    </main>
  );
}

function App() {
  if (new URLSearchParams(window.location.search).has("branch-picker"))
    return <SidebarBranchPickerFixture />;
  if (new URLSearchParams(window.location.search).has("change-review"))
    return <ChangeReviewFixture />;
  if (new URLSearchParams(window.location.search).has("branch-attention"))
    return <BranchAttentionFixture />;
  if (/^\/projects\/[^/]+\/settings(?:\/|$)/.test(window.location.pathname))
    return <SettingsContextFixture />;
  if (new URLSearchParams(window.location.search).has("editor-settings"))
    return <EditorSettingsFixture />;
  if (new URLSearchParams(window.location.search).has("git-operation"))
    return <GitOperationFixture />;
  if (new URLSearchParams(window.location.search).has("branch-import"))
    return <BranchImportFixture />;
  if (new URLSearchParams(window.location.search).has("video"))
    return (
      <div className="wb-binary-preview">
        <AssetVideo name="demo.mp4" src="/api/projects/p/assets?path=static/video/demo.mp4" />
      </div>
    );
  if (new URLSearchParams(window.location.search).has("path-completions"))
    return <PathCompletionsFixture />;
  if (new URLSearchParams(window.location.search).has("preview-header"))
    return (
      <div className="workbench">
        <header className="wb-header">
          <div>
            <small>Проект</small>
            <h1>Документы</h1>
          </div>
          <div className="wb-actions">
            <LivePreviewButton projectId="project" branch="stable" autoStart />
            <a className="wb-primary" href="#changes">
              К изменениям (0)
            </a>
          </div>
        </header>
      </div>
    );
  if (new URLSearchParams(window.location.search).has("submit"))
    return (
      <main className="page changes-page">
        <h1>Изменения в ветке</h1>
        <div className="branch-git-actions">
          <SubmitChanges
            action={async (data) => {
              const response = await fetch("/fixture-submit", {
                method: "POST",
                body: JSON.stringify(Object.fromEntries(data)),
              });
              if (!response.ok) throw new Error("Submission failed");
            }}
            retryAction={
              new URLSearchParams(window.location.search).has("failed")
                ? async (data) => {
                    await fetch("/fixture-retry", {
                      method: "POST",
                      body: JSON.stringify(Object.fromEntries(data)),
                    });
                  }
                : undefined
            }
            projectId="project"
            changeSetId="12345678-rest"
            branch="stable"
            defaultBranch="stable"
            disabled={false}
            submitting={false}
            reviewLabel="MR"
          />
        </div>
        <div className="changes-layout">
          <DiffViewer before="Before" after="After" />
        </div>
      </main>
    );
  if (new URLSearchParams(window.location.search).has("comments")) return <CommentsFixture />;
  if (new URLSearchParams(window.location.search).has("reviews")) {
    const updateReason = new URLSearchParams(window.location.search).get("update");
    const branch = updateReason ? `docs/${"long-branch-name-".repeat(6)}` : "docs/update";
    const details = {
      branchUpdatePolicy: resolvedBranchUpdatePolicy({
        strategy:
          new URLSearchParams(window.location.search).get("strategy") === "merge"
            ? BranchUpdateStrategy.Merge
            : BranchUpdateStrategy.Rebase,
      }),
      headSha: "sha",
      readiness: { state: "blocked" as const, reason: updateReason ?? "not_approved" },
      labels: [
        { name: "documentation", color: "#abcdef" },
        { name: "very-long-label-".repeat(5), color: "#ff0000" },
      ],
      approvals: {
        required: 2,
        remaining: 1,
        reviewers: [
          { name: "Anna", state: "approved" as const },
          { name: "Bob", state: "changes_requested" as const },
        ],
      },
      comments: [
        {
          id: "note",
          author: "Anna",
          body: `Read-only comment\n${"LongComment".repeat(40)}`,
          createdAt: "2026-09-15T09:00:00Z",
        },
      ],
      commentsComplete: true,
      source: { repositoryId: "main", isFork: false, branchUrl: null },
    };
    const review = {
      id: "review-7",
      source_branch: branch,
      target_branch: "stable",
      provider_url: "https://git.example/review/7",
      details,
    };
    const hasConflicts = hasBranchConflicts(details.readiness.reason);
    const branchAction = (
      <ReviewBranchAction
        projectId="project"
        ownerId="user"
        provider="gitlab"
        canWrite
        review={review}
        hasPendingChanges={new URLSearchParams(window.location.search).has("pending")}
        actionOnly={!hasConflicts}
      />
    );
    if (new URLSearchParams(window.location.search).has("changes")) {
      const hasPendingChanges = new URLSearchParams(window.location.search).has("pending");
      return (
        <main className="page changes-page">
          <h1>Изменения в ветке</h1>
          {hasBranchConflicts(details.readiness.reason) &&
          details.branchUpdatePolicy.strategy === BranchUpdateStrategy.Merge ? (
            <BranchConflictNotice
              projectId="project"
              ownerId="user"
              reviewId={review.id}
              branch={branch}
              currentBranch={branch}
              targetBranch="stable"
              canWrite
              hasPendingChanges={hasPendingChanges}
              providerUrl={review.provider_url}
              reviewLabel="MR"
            />
          ) : (
            <ReviewBranchUpdate
              provider="gitlab"
              projectId="project"
              ownerId="user"
              canWrite
              review={review}
              hasPendingChanges={hasPendingChanges}
            />
          )}
        </main>
      );
    }
    return (
      <main className="page reviews-page">
        <h1>MR</h1>
        <ReviewMissingBranchNotice
          projectId="project"
          defaultBranch="stable"
          branchReviews={[
            {
              ...review,
              external_id: "7",
              state: "open",
              title: "Documentation",
            },
          ]}
          reviewLabel="MR"
        />
        <div className="reviews-layout">
          <ReviewBranchList
            projectId="project"
            defaultBranch="stable"
            reviewLabel="MR"
            reviews={[
              {
                id: "review-8",
                branch: "docs/other",
                isFork: false,
                content: (
                  <a href="?reviews&amp;review=8">
                    <GitPullRequest aria-hidden size={17} />
                    <span>
                      <strong>Other documentation</strong>
                      <small>!8 docs/other → stable</small>
                    </span>
                  </a>
                ),
              },
              {
                id: review.id,
                branch,
                isFork: false,
                content: (
                  <a className="active" href="?reviews&amp;review=7">
                    <GitPullRequest aria-hidden size={17} />
                    <span>
                      <strong>Update documentation</strong>
                      <small>!7 {branch} → stable</small>
                      <span className="review-list-statuses">
                        <ReviewReadiness details={details} showAction />
                      </span>
                    </span>
                  </a>
                ),
              },
            ]}
          />
          <section className="review-detail">
            <header className="review-heading">
              <Status tone="success">Открыт</Status>
              <h2>Update documentation</h2>
              <p>{branch} → stable</p>
              {hasConflicts ? branchAction : null}
            </header>
            <nav className="review-actions" aria-label="Действия с MR">
              <ReviewBranchSwitch
                projectId="project"
                branch={branch}
                defaultBranch="stable"
                isFork={false}
              />
              <div className="review-primary-actions">
                <a
                  className="pd-button pd-button--secondary review-provider-link"
                  href={review.provider_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Открыть MR в GitLab <ExternalLink aria-hidden size={15} />
                </a>
                {!hasConflicts ? branchAction : null}
                {new URLSearchParams(window.location.search).has("review-preview") ? (
                  <a className="pd-button pd-button--secondary" href="#preview">
                    Открыть предпросмотр
                  </a>
                ) : null}
              </div>
            </nav>
            <ReviewInformation
              details={details}
              showReadiness={
                !needsBranchUpdate(details) && !hasBranchConflicts(details.readiness.reason)
              }
            />
          </section>
        </div>
      </main>
    );
  }

  if (new URLSearchParams(window.location.search).has("quickopen")) {
    const files = Array.from({ length: 30 }, (_, index) => ({
      path: `docs/article-${index}.md`,
      title: `Статья ${index}`,
      content: "Строка с test и TEST для поиска",
      status: "clean",
    }));
    return (
      <div className="wb-modal-backdrop">
        <section className="wb-modal wb-search-modal" role="dialog" aria-label="Поиск файлов">
          <header>
            <h2>Поиск файлов</h2>
            <button type="button" className="wb-modal-close" aria-label="Закрыть">
              <X aria-hidden size={18} />
            </button>
          </header>
          <QuickOpen paths={files.map((file) => file.path)} files={files} onOpen={() => {}} />
        </section>
      </div>
    );
  }
  if (new URLSearchParams(window.location.search).has("diffs"))
    return (
      <main className="page">
        <DiffViewer before="old" after="new" />
        <DiffViewer before="before" after="after" />
      </main>
    );
  if (new URLSearchParams(window.location.search).has("danger-buttons"))
    return (
      <main className="page">
        <Button tone="danger">Удалить снаружи редактора</Button>
        <div className="workbench">
          <Button tone="danger">Удалить из медиатеки</Button>
          <button type="button" className="wb-danger-button">
            Подтвердить удаление
          </button>
        </div>
      </main>
    );
  if (new URLSearchParams(window.location.search).has("media"))
    return (
      <div className="wb-modal-backdrop">
        <section className="wb-modal wb-media-modal" role="dialog" aria-label="Вложения">
          <header>
            <h2>Вложения</h2>
            <button type="button" className="wb-modal-close" aria-label="Закрыть">
              <X aria-hidden size={18} />
            </button>
          </header>
          <MediaLibrary
            projectId="p"
            branch="docs/test-pushdocs"
            document="docs/ecom/ecom-statistics.mdx"
            replacePath={new URLSearchParams(window.location.search).get("replace") ?? undefined}
            onInsert={() => {}}
            insertionMode={
              new URLSearchParams(window.location.search).has("images")
                ? MediaInsertionMode.Images
                : undefined
            }
          />
        </section>
      </div>
    );
  if (new URLSearchParams(window.location.search).has("collaboration"))
    return <CollaborationFixture />;
  if (window.location.pathname === workbenchSearchFixture.path) return <WorkbenchSearchFixture />;
  if (new URLSearchParams(window.location.search).has("workbench"))
    return <WorkbenchScrollFixture />;
  if (new URLSearchParams(window.location.search).has("branches"))
    return (
      <main className="workbench" style={{ padding: 24 }}>
        <SearchableSelect
          className="wb-branch-picker"
          label="Текущая ветка"
          options={[
            { value: "stable", label: "stable" },
            { value: "feat/create-translate-script", label: "feat/create-translate-script" },
            { value: "fix/how-to-use-tilda-data", label: "fix/how-to-use-tilda-data" },
          ]}
          searchLabel="Поиск по веткам"
          searchPlaceholder="Найти ветку…"
          value="stable"
        />
      </main>
    );
  if (new URLSearchParams(window.location.search).has("controls"))
    return (
      <main className="page">
        <section className="invitation-result">
          <strong>Приглашение создано</strong>
          <CopyInvitation value="https://docs.example/invite/example-long-invitation-link" />
        </section>
        <div style={{ display: "grid", gap: 16, justifyItems: "start" }}>
          <button type="button">Изменить доступ</button>
          <label>
            <input type="checkbox" /> Создать MR
          </label>
          <label htmlFor="fixture-profile">
            Профиль OpenVPN
            <FilePicker id="fixture-profile" aria-label="Профиль OpenVPN" name="vpnProfile" />
          </label>
        </div>
      </main>
    );
  return <SettingsFixture />;
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
