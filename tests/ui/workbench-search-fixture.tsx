import { Workbench, type WorkbenchState } from "../../apps/web/src/components/workbench";
import { parseProjectConfig } from "../../packages/content/src/config";
import { workbenchSearchFixture } from "./workbench-search-data";

const files = Array.from({ length: 40 }, (_, index) => {
  const name = String(index + 1).padStart(2, "0");
  const content = `# Статья ${name}\n\nискомое слово в статье ${name}`;
  return {
    path: `docs/article-${name}.md`,
    title: `Статья ${name}`,
    content,
    baseContent: content,
    locale: "ru",
    version: "current",
    status: "clean",
  };
});

const initial: WorkbenchState = {
  ownerId: "anna",
  files,
  repositoryPaths: files.map((file) => file.path),
  config: parseProjectConfig(JSON.stringify({ version: 1 })),
  branches: [{ full_ref: "main" }],
  revision: 0,
  status: "open",
  sha: "12345678",
  role: "editor",
};

export function WorkbenchSearchFixture() {
  return (
    <div className="app-frame">
      <aside className="app-sidebar">PushDocs</aside>
      <main className="app-main">
        <Workbench
          projectId={workbenchSearchFixture.projectId}
          projectName="Документация"
          branch="main"
          initial={initial}
        />
      </main>
    </div>
  );
}
