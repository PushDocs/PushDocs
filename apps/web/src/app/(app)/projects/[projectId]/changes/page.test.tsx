import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const submitChangesProps = vi.hoisted(() => vi.fn());
const repository = vi.hoisted(() => ({
  getProjectForUser: vi.fn().mockResolvedValue({
    id: "project",
    defaultBranch: "stable",
    provider: "gitlab",
    role: "editor",
  }),
  listDraftFiles: vi
    .fn()
    .mockResolvedValue([
      { path: "docs/a.md", operation: "modify", status: "open", change_set_id: "set" },
    ]),
  listChangedWorkingFiles: vi.fn().mockResolvedValue({
    branch: { repository_paths: ["docs/a.md", "static/existing.png"] },
    files: [
      { path: "docs/a.md", baseContent: "Before server draft", content: "After server draft" },
    ],
  }),
  listAttachmentsForBranch: vi.fn().mockResolvedValue([
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
  ]),
  listConflicts: vi.fn().mockResolvedValue([]),
  getSubmissionStatus: vi.fn().mockResolvedValue(null),
  findOpenChangeRequestByBranch: vi
    .fn()
    .mockResolvedValue({ id: "mr", source_branch: "fix", state: "open", title: "Update docs" }),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (value: unknown) => value,
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
vi.mock("@/components/submit-changes", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/components/submit-changes")>();
  return {
    ...original,
    SubmitChanges: (props: Parameters<typeof original.SubmitChanges>[0]) => {
      submitChangesProps(props);
      return <original.SubmitChanges {...props} />;
    },
  };
});

import ChangesPage from "./page";

it("uses the selected branch's actual before/after content and distinguishes replaced from new attachments", async () => {
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(repository.listChangedWorkingFiles).toHaveBeenCalledWith("project", "fix");
  expect(html).toContain("Before server draft");
  expect(html).toContain("After server draft");
  expect(html).toContain('aria-label="static/existing.png M"');
  expect(html).toContain('aria-label="static/new.png A"');
  expect(html).not.toContain("static/other.png");
  expect(html).toContain("Отправить изменения");
  expect(html).not.toContain("Редактировать ветку");
  expect(html).not.toContain('class="submit-panel"');
  expect(html).not.toContain('name="message"');
  expect(html).toContain("Открыть MR: Update docs");
  expect(html).not.toContain("предпросмотр");
  expect(html).toContain('href="/projects/project/reviews?review=mr"');
  expect(html).toContain('<li class="active" aria-current="step"><span>1</span>Правки</li>');
});

it.each([
  { status: "queued", stage: 2 },
  { status: "done", stage: 3 },
])("shows branch workflow stage $stage for a $status submission", async ({ status, stage }) => {
  repository.listDraftFiles.mockResolvedValueOnce([]);
  repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
  repository.listChangedWorkingFiles.mockResolvedValueOnce({
    branch: { repository_paths: ["docs/a.md"] },
    files: [],
  });
  repository.findOpenChangeRequestByBranch.mockResolvedValueOnce(null);
  repository.getSubmissionStatus.mockResolvedValueOnce({ status });
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html).toContain(
    `<li class="active" aria-current="step"><span>${stage}</span>${stage === 2 ? "Коммит в ветку" : "MR"}</li>`,
  );
});

it("does not reopen an already released failed submission in recovery mode", async () => {
  repository.getSubmissionStatus.mockResolvedValueOnce({
    status: "failed",
    last_error: "Git fetch failed (null): fatal: early EOF",
  });

  renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );

  const props = submitChangesProps.mock.calls.at(-1)?.[0];
  expect(props.retryAction).toBeUndefined();
  expect(props.children).toBeNull();
});
