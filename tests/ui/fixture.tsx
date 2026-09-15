import { useState } from "react";
import { createRoot } from "react-dom/client";
import { CopyInvitation } from "../../apps/web/src/components/copy-invitation";
import { FilePicker } from "../../apps/web/src/components/file-picker";
import { SettingsModal, useSettingsModal } from "../../apps/web/src/components/settings-modal";
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
        <input name="name" defaultValue="Sendsay" />
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
function SettingsFixture() {
  const [open, setOpen] = useState(false);
  return (
    <main className="page">
      <button type="button" onClick={() => setOpen(true)}>
        Открыть форму
      </button>
      <button type="button">За пределами окна</button>
      {open ? (
        <SettingsModal title="Подключение" onClose={() => setOpen(false)}>
          <Form />
        </SettingsModal>
      ) : null}
    </main>
  );
}

function App() {
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
