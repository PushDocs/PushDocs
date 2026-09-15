import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyInvitation } from "../../apps/web/src/components/copy-invitation";
import { DiffViewer } from "../../apps/web/src/components/diff-viewer";
import { FileComments, FileCommentsButton } from "../../apps/web/src/components/file-comments";
import { FilePicker } from "../../apps/web/src/components/file-picker";
import { MediaLibrary } from "../../apps/web/src/components/media-library";
import { QuickOpen } from "../../apps/web/src/components/quick-open";
import {
  ReviewInformation,
  ReviewReadiness,
} from "../../apps/web/src/components/review-information";
import { SettingsModal, useSettingsModal } from "../../apps/web/src/components/settings-modal";
import { useFileComments } from "../../apps/web/src/components/use-file-comments";
import { SearchableSelect, Select } from "../../packages/ui/src";
import { CollaborationFixture } from "./collaboration-fixture";
import { WorkbenchScrollFixture } from "./workbench-scroll-fixture";
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
  if (new URLSearchParams(window.location.search).has("comments")) return <CommentsFixture />;
  if (new URLSearchParams(window.location.search).has("reviews")) {
    const details = {
      headSha: "sha",
      readiness: { state: "blocked" as const, reason: "not_approved" },
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
    };
    return (
      <main className="page reviews-page">
        <h1>MR</h1>
        <div className="reviews-layout">
          <nav className="review-list" aria-label="Список MR">
            <a href="?reviews&amp;review=7">
              <span aria-hidden>↗</span>
              <span>
                <strong>Update documentation</strong>
                <small>!7 docs/update → stable</small>
                <ReviewReadiness details={details} />
              </span>
            </a>
          </nav>
          <section className="review-detail">
            <header className="review-heading">
              <h2>Update documentation</h2>
            </header>
            <ReviewInformation details={details} />
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
            <button type="button">Закрыть</button>
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
  if (new URLSearchParams(window.location.search).has("media"))
    return (
      <div className="wb-modal-backdrop">
        <section className="wb-modal wb-media-modal" role="dialog" aria-label="Вложения">
          <header>
            <h2>Вложения</h2>
            <button type="button">Закрыть</button>
          </header>
          <MediaLibrary
            projectId="p"
            branch="docs/test-pushdocs"
            document="docs/ecom/ecom-statistics.mdx"
            onInsert={() => {}}
          />
        </section>
      </div>
    );
  if (new URLSearchParams(window.location.search).has("collaboration"))
    return <CollaborationFixture />;
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
