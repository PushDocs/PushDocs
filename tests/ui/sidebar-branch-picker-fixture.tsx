import type { BranchSummary } from "@pushdocs/contracts";
import { useState } from "react";
import { SidebarBranchPicker } from "../../apps/web/src/components/sidebar-branch-picker";

const branches: BranchSummary[] = [
  { full_ref: "main" },
  {
    full_ref: "docs/active",
    lastCommitAt: "2026-11-15T12:00:00Z",
    review: { state: "open", externalId: "814", targetBranch: "main" },
  },
  {
    full_ref: "docs/merged",
    lastCommitAt: "2026-11-14T12:00:00Z",
    review: { state: "merged", externalId: "813", targetBranch: "main" },
    isCompleted: true,
  },
  {
    full_ref: "docs/closed",
    isCompleted: true,
    review: { state: "closed", externalId: "812", targetBranch: "main" },
  },
  { full_ref: "docs/older", lastCommitAt: "2025-11-15T12:00:00Z" },
  {
    full_ref: "docs/older-closed",
    lastCommitAt: "2025-11-14T12:00:00Z",
    isCompleted: true,
    review: { state: "closed", externalId: "800", targetBranch: "main" },
  },
  ...Array.from({ length: 20 }, (_, index) => ({
    full_ref: `docs/article-${index}-${"long-branch-name-".repeat(3)}`,
    lastCommitAt: "2026-11-13T12:00:00Z",
  })),
];

export function SidebarBranchPickerFixture() {
  const [value, setValue] = useState("main");
  return (
    <main className="page">
      <div style={{ width: 240 }}>
        <SidebarBranchPicker
          branches={branches}
          defaultBranch="main"
          value={value}
          onValueChange={setValue}
          ownerId="owner"
          projectId="project"
          provider="gitlab"
        />
      </div>
      <p role="status">Выбрана ветка: {value}</p>
    </main>
  );
}
