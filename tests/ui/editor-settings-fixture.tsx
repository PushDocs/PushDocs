import { useRef, useState } from "react";
import { AppShell } from "../../apps/web/src/components/app-shell";
import { DiffViewer } from "../../apps/web/src/components/diff-viewer";
import { EditorSettings } from "../../apps/web/src/components/editor-settings";
import { SettingsNavigation } from "../../apps/web/src/components/settings-navigation";
import { SourceEditor, type SourceEditorHandle } from "../../apps/web/src/components/source-editor";
import type { SettingsSection } from "../../apps/web/src/lib/settings-path";

const source = [
  "The installer creates `.env`, builds images, applies migrations and starts services. ".repeat(
    12,
  ),
  "",
  `https://example.com/${"long-path-segment/".repeat(60)}`,
  "Last line",
].join("\n");

export function EditorSettingsFixture() {
  const [value, setValue] = useState(source);
  const [jump, setJump] = useState<{ line: number; token: number }>();
  const inputRef = useRef<SourceEditorHandle>(null);
  if (new URLSearchParams(window.location.search).has("settings-page"))
    return (
      <section className="page narrow-page">
        <header className="page-header">
          <h1>Редактор</h1>
        </header>
        <SettingsNavigation active="editor" canManageConnections={false} />
        <EditorSettings />
      </section>
    );
  return (
    <main className="page" style={{ maxWidth: 900, marginInline: "auto" }}>
      <EditorSettings />
      <button type="button" onClick={() => setJump({ line: 4, token: Date.now() })}>
        К последней строке
      </button>
      <div className="workbench">
        <div className="wb-document-body" style={{ height: 320, flex: "none", marginBlock: 16 }}>
          <SourceEditor
            path="file.md"
            inputRef={inputRef}
            value={value}
            jump={jump}
            onChange={setValue}
            onSave={() => {}}
            onIndent={() => {}}
            readOnly={new URLSearchParams(window.location.search).has("readonly")}
          />
        </div>
        <DiffViewer before={source} after={`${source}\nAdded line`} />
      </div>
    </main>
  );
}

export function SettingsContextFixture() {
  const match = window.location.pathname.match(/^\/projects\/([^/]+)\/settings(?:\/([^/]+))?/);
  const projectId = match?.[1];
  const active = (match?.[2] ?? "project") as SettingsSection;
  const projects = ["one", "two"].map((id) => ({
    id,
    name: id === "one" ? "Product Docs" : "API Docs",
    slug: id,
    provider: "gitlab" as const,
    providerLabel: "GitLab",
    defaultBranch: "main",
    role: "admin" as const,
    syncStatus: "current" as const,
    openChangeRequests: 0,
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
  return (
    <AppShell
      projects={projects}
      user={{
        id: "user",
        displayName: "Anna",
        email: "anna@example.test",
        isInstanceOperator: true,
      }}
      branchesByProject={{ one: [{ full_ref: "main" }], two: [{ full_ref: "main" }] }}
    >
      <section className="page narrow-page">
        <header className="page-header">
          <h1>Настройки</h1>
        </header>
        <SettingsNavigation projectId={projectId} active={active} canManageConnections />
        {active === "editor" ? <EditorSettings /> : <p>Настройки {active}</p>}
      </section>
    </AppShell>
  );
}
