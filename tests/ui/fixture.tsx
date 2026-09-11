import { useState } from "react";
import { createRoot } from "react-dom/client";
import { SettingsModal, useSettingsModal } from "../../apps/web/src/components/settings-modal";
import { Select } from "../../packages/ui/src";
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
function App() {
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
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
