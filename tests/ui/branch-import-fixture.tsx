import { StrictMode, useEffect, useState } from "react";
import {
  BranchImport,
  ProjectBranchImportProgress,
} from "../../apps/web/src/components/branch-import";

export function BranchImportFixture() {
  const [section, setSection] = useState("documents");
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const refresh = () => setReady(true);
    window.addEventListener("fixture:refresh", refresh);
    return () => window.removeEventListener("fixture:refresh", refresh);
  }, []);
  return (
    <StrictMode>
      <nav aria-label="Разделы проекта">
        <button type="button" onClick={() => setSection("documents")}>
          Документы
        </button>
        <button type="button" onClick={() => setSection("reviews")}>
          MR
        </button>
      </nav>
      <ProjectBranchImportProgress
        projectId="project"
        ownerId="user"
        hidden={section === "documents"}
      />
      {section === "documents" ? (
        ready ? (
          <h1>Документы загружены</h1>
        ) : (
          <BranchImport projectId="project" branch="docs/task" />
        )
      ) : (
        <h1>Список MR</h1>
      )}
    </StrictMode>
  );
}
