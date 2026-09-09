import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const repository = vi.hoisted(() => ({
  requireProjectAccess: vi.fn().mockResolvedValue({ role: "editor" }),
  listDraftFiles: vi
    .fn()
    .mockResolvedValue([
      { path: "docs/a.md", operation: "modify", status: "open", change_set_id: "set" },
    ]),
  listWorkingFiles: vi.fn().mockResolvedValue({
    branch: { repository_paths: ["docs/a.md", "static/existing.png"] },
    files: [
      { path: "docs/a.md", baseContent: "Before server draft", content: "After server draft" },
    ],
  }),
  listAttachments: vi.fn().mockResolvedValue([
    {
      repository_path: "static/existing.png",
      branch: "fix",
      change_set_status: "open",
      change_set_id: "set",
    },
    {
      repository_path: "static/new.png",
      branch: "fix",
      change_set_status: "open",
      change_set_id: "set",
    },
    {
      repository_path: "static/other.png",
      branch: "other",
      change_set_status: "open",
      change_set_id: "other-set",
    },
  ]),
  listConflicts: vi.fn().mockResolvedValue([]),
  getSubmissionStatus: vi.fn().mockResolvedValue(null),
  listChangeRequests: vi
    .fn()
    .mockResolvedValue([{ id: "mr", source_branch: "fix", state: "open", title: "Update docs" }]),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (value: unknown) => value,
  application: () => ({
    listProjects: async () => [{ id: "project", defaultBranch: "stable", provider: "gitlab" }],
  }),
  repository: () => repository,
}));
vi.mock("@/app/actions", () => ({
  resolveConflictAction: vi.fn(),
  retryChangeSetSubmissionAction: vi.fn(),
  submitChangeSetAction: vi.fn(),
  startGitOperationAction: vi.fn(),
  gitOperationStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ChangesPage from "./page";

it("uses the selected branch's actual before/after content and distinguishes replaced from new attachments", async () => {
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(repository.listWorkingFiles).toHaveBeenCalledWith("project", "fix");
  expect(html).toContain("Before server draft");
  expect(html).toContain("After server draft");
  expect(html).toContain('aria-label="static/existing.png M"');
  expect(html).toContain('aria-label="static/new.png A"');
  expect(html).not.toContain("static/other.png");
  expect(html).toContain("Отправить в MR");
  expect(html).toContain("Открыть MR: Update docs");
});
