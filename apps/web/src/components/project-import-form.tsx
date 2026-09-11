"use client";
import { Select } from "@pushdocs/ui";
import { useState } from "react";
import { inspectProjectRepository } from "@/app/actions";
import { CriticalForm } from "./critical-form";

type Inspection = Awaited<ReturnType<typeof inspectProjectRepository>>;
export function ProjectImportForm({
  connections,
}: {
  connections: Array<{ id: string; name: string; kind: string }>;
}) {
  const [connectionId, setConnection] = useState(connections[0]?.id ?? "");
  const [locator, setLocator] = useState("");
  const [inspection, setInspection] = useState<Inspection>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return inspection ? (
    <CriticalForm
      warnBefore
      kind="createProject"
      className="project-form project-import-form"
      description={`Импортировать проект: ${inspection.name}`}
    >
      <p role="status">Доступ к репозиторию проверен.</p>
      <input name="connectionId" type="hidden" value={connectionId} />
      <input name="repositoryProviderId" type="hidden" value={inspection.id} />
      <label>
        Название
        <input name="name" defaultValue={inspection.name} required />
      </label>
      <label>
        Короткий адрес
        <input
          name="slug"
          defaultValue={
            inspection.name
              .toLowerCase()
              .replace(/[^a-z0-9]+/g, "-")
              .replace(/^-|-$/g, "") || "docs"
          }
          pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
          required
        />
      </label>
      <details open={inspection.roots.length !== 1}>
        <summary>Параметры импорта</summary>
        <label htmlFor="import-branch">Основная ветка</label>
        <Select
          id="import-branch"
          label="Основная ветка"
          name="defaultBranch"
          defaultValue={inspection.defaultBranch}
          options={inspection.branches.map((branch) => ({ value: branch, label: branch }))}
        />
        <label>
          Каталог сайта
          <input name="rootPath" defaultValue={inspection.roots[0] ?? "."} required />
        </label>
        <p>
          {inspection.roots.length
            ? `Найдены каталоги Docusaurus: ${inspection.roots.join(", ")}`
            : "Конфигурация Docusaurus не найдена. Укажите каталог сайта перед импортом."}
        </p>
      </details>
      <div className="form-actions">
        <button type="button" onClick={() => setInspection(undefined)}>
          Другой репозиторий
        </button>
        <button type="submit" className="pd-button pd-button--primary">
          Импортировать проект
        </button>
      </div>
    </CriticalForm>
  ) : (
    <form
      className="project-form project-import-form"
      onSubmit={async (event) => {
        event.preventDefault();
        if (busy) return;
        setBusy(true);
        setError("");
        try {
          setInspection(await inspectProjectRepository({ connectionId, locator }));
        } catch {
          setError(
            "Не удалось проверить репозиторий. Проверьте адрес, права подключения и доступность Git.",
          );
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset disabled={busy} className="critical-fields">
        <label htmlFor="import-connection">Подключение</label>
        <Select
          id="import-connection"
          label="Подключение"
          name="connectionId"
          value={connectionId}
          onValueChange={setConnection}
          options={connections.map((connection) => ({
            value: connection.id,
            label: connection.name,
          }))}
          required
        />
        <label>
          Адрес репозитория
          <input
            value={locator}
            onChange={(event) => setLocator(event.target.value)}
            placeholder="https://gitlab.example.com/team/docs"
            required
          />
        </label>
        <button type="submit" className="pd-button pd-button--primary">
          {busy ? "Проверяем репозиторий…" : "Проверить и продолжить"}
        </button>
      </fieldset>
      {error ? <p role="alert">{error}</p> : null}
    </form>
  );
}
