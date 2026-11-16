import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const submitChangesProps = vi.hoisted(() => vi.fn());
const repository = vi.hoisted(() => ({
  listChangeRequests: vi.fn().mockResolvedValue([
    {
      id: "mr",
      source_branch: "fix",
      target_branch: "release",
      title: "Update docs",
      provider_url: "https://git.example/mr",
      details: { source: { isFork: false }, readiness: { state: "blocked", reason: "conflict" } },
    },
  ]),
  listBranches: vi.fn().mockResolvedValue([{ id: "branch", full_ref: "fix" }]),
  hasImportedBranch: vi.fn().mockResolvedValue(true),
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
  listChangedWorkingFiles: vi.fn(async (_projectId: string, branch: string) => {
    if (branch === "doc/790") throw new Error("Branch not found");
    return {
      branch: { repository_paths: ["docs/a.md", "static/existing.png"] },
      files: [
        { path: "docs/a.md", baseContent: "Before server draft", content: "After server draft" },
      ],
    };
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
  getActiveReviewBranchUpdate: vi.fn(),
  findOpenChangeRequestByBranch: vi
    .fn()
    .mockResolvedValue({ id: "mr", source_branch: "fix", state: "open", title: "Update docs" }),
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (value: unknown) => value,
  repository: () => repository,
}));
vi.mock("@/app/conflict-actions", () => ({
  inspectReviewConflictsAction: vi.fn(),
  prepareConflictResolutionAction: vi.fn(),
  submitConflictResolutionAction: vi.fn(),
  retryConflictResolutionAction: vi.fn(),
}));
vi.mock("@/app/actions", () => ({
  resolveConflictAction: vi.fn(),
  retryChangeSetSubmissionAction: vi.fn(),
  submitChangeSetAction: vi.fn(),
  startGitOperationAction: vi.fn(),
  gitOperationStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/review-branch-update", async (importOriginal) => {
  const { ReviewBranchUpdate } =
    await importOriginal<typeof import("@/components/review-branch-update")>();
  // Server pages may render this client component, but must not call its other exports.
  return { ReviewBranchUpdate };
});
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

vi.mock("@/components/branch-import", () => ({ BranchImport: () => null }));

import { BranchConflictResolver } from "@/components/branch-conflicts";
import { BranchImport } from "@/components/branch-import";
import ChangesPage from "./page";

it.each([
  { provider: "gitlab", reviewLabel: "MR" },
  { provider: "github", reviewLabel: "PR" },
])(
  "offers one link to the $reviewLabel page after changes are sent",
  async ({ provider, reviewLabel }) => {
    repository.getProjectForUser.mockResolvedValueOnce({
      id: "project",
      defaultBranch: "stable",
      provider,
      role: "editor",
    });
    repository.listDraftFiles.mockResolvedValueOnce([]);
    repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
    repository.findOpenChangeRequestByBranch.mockResolvedValueOnce({
      id: "mr",
      source_branch: "fix",
      state: "open",
      title: "Update docs",
      provider_url: "https://git.example/review/123",
    });
    const html = renderToStaticMarkup(
      await ChangesPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({ branch: "fix" }),
      }),
    );
    expect(html).toContain("Все изменения отправлены");
    expect(html.match(/href="\/projects\/project\/reviews\?review=mr"/g)).toHaveLength(1);
    expect(html).toContain(`Открыть ${reviewLabel}`);
    expect(html).not.toContain('href="https://git.example/review/123"');
    expect(html).not.toContain(`Создать ${reviewLabel}`);
  },
);

it("opens normal changes with a notice instead of preparation when the review branch is dirty", async () => {
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ resolve: "mr" }),
    }),
  );
  expect(html).toContain("Изменения в ветке");
  expect(html).toContain("Before server draft");
  expect(html).toContain("After server draft");
  expect(html).toContain("Сначала разберитесь с текущими правками");
  expect(html).not.toContain("Подготовка к разрешению конфликтов");
  expect(html).not.toContain("Проверить состояние и продолжить");
});

it.each(["need_rebase", "behind"])("prioritizes current changes before %s", async (reason) => {
  repository.findOpenChangeRequestByBranch.mockResolvedValueOnce({
    id: "mr",
    source_branch: "fix",
    target_branch: "release",
    state: "open",
    title: "Update docs",
    provider_url: "https://git.example/mr",
    details: { readiness: { state: "blocked", reason } },
  } as never);
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html).toContain('aria-label="Обновление ветки"');
  expect(html).toContain("release");
  expect(html).toContain("Сначала завершите текущие правки");
  expect(html).not.toContain("Обновить ветку");
  expect(html).toContain("Отправить изменения");
  expect(html).not.toContain('href="https://git.example/mr"');
  expect(html).toContain("Обновить из Git");
  expect(html).not.toContain("Получить из Git");
  expect(html).not.toContain("Разрешить конфликты");
});

it.each(["conflict", "dirty"])(
  "shows successive actions for a branch with %s and a required rebase",
  async (reason) => {
    const review = {
      id: "mr",
      source_branch: "fix",
      target_branch: "release",
      state: "open",
      title: "Update docs",
      provider_url: "https://git.example/mr",
      details: {
        source: { isFork: false },
        readiness: { state: "blocked", reason },
        requiredUpdateStrategy: "rebase",
      },
    };
    const renderPage = async () =>
      renderToStaticMarkup(
        await ChangesPage({
          params: Promise.resolve({ projectId: "project" }),
          searchParams: Promise.resolve({ branch: "fix", conflict: "mr" }),
        }),
      );
    repository.findOpenChangeRequestByBranch.mockResolvedValueOnce(review);
    repository.listChangeRequests.mockResolvedValueOnce([review]);
    const pendingHtml = await renderPage();
    expect(pendingHtml.match(/class="branch-notice /g)).toHaveLength(1);
    expect(pendingHtml).toContain("Сначала завершите текущие правки");
    expect(pendingHtml).toContain("Отправить изменения");
    expect(pendingHtml).not.toContain("Разрешить конфликты");
    expect(pendingHtml).not.toContain('aria-label="Обновление ветки"');

    repository.listDraftFiles.mockResolvedValueOnce([]);
    repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
    repository.findOpenChangeRequestByBranch.mockResolvedValueOnce(review);
    repository.listChangeRequests.mockResolvedValueOnce([review]);
    const conflictHtml = await renderPage();
    expect(conflictHtml.match(/class="branch-notice /g)).toHaveLength(1);
    expect(conflictHtml).toContain("Ветка конфликтует с release");
    expect(conflictHtml).toContain("Разрешить конфликты");
    expect(conflictHtml).not.toContain("Сначала завершите текущие правки");
    expect(conflictHtml).not.toContain('aria-label="Обновление ветки"');

    const updatedReview = {
      ...review,
      details: { ...review.details, readiness: { state: "blocked", reason: "need_rebase" } },
    };
    repository.listDraftFiles.mockResolvedValueOnce([]);
    repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
    repository.findOpenChangeRequestByBranch.mockResolvedValueOnce(updatedReview);
    const updateHtml = renderToStaticMarkup(
      await ChangesPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({ branch: "fix" }),
      }),
    );
    expect(updateHtml.match(/class="branch-notice /g)).toHaveLength(1);
    expect(updateHtml).toContain("Обновить ветку");
    expect(updateHtml).not.toContain("Разрешить конфликты");
  },
);

it("prioritizes recovery of an active update over stale conflicts and current changes", async () => {
  repository.findOpenChangeRequestByBranch.mockResolvedValueOnce({
    id: "mr",
    source_branch: "fix",
    target_branch: "release",
    state: "open",
    title: "Update docs",
    details: {
      readiness: { state: "blocked", reason: "conflict" },
      source: { isFork: false },
    },
  });
  repository.getActiveReviewBranchUpdate.mockResolvedValueOnce({
    payload: { reviewId: "mr", strategy: "rebase", expectedHeadSha: "original-head" },
  });
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html.match(/class="branch-notice /g)).toHaveLength(1);
  expect(html).toContain("Продолжить обновление ветки");
  expect(html).not.toContain("Разрешить конфликты");
  expect(html).not.toContain("Сначала завершите текущие правки");
});

it.each(["need_rebase", "conflict"])(
  "avoids duplicate Git and MR actions for a clean branch with %s",
  async (reason) => {
    repository.listDraftFiles.mockResolvedValueOnce([]);
    repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
    repository.findOpenChangeRequestByBranch.mockResolvedValueOnce({
      id: "mr",
      source_branch: "fix",
      target_branch: "release",
      state: "open",
      title: "Update docs",
      provider_url: "https://git.example/mr",
      details: { source: { isFork: false }, readiness: { state: "blocked", reason } },
    } as never);
    const html = renderToStaticMarkup(
      await ChangesPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({ branch: "fix" }),
      }),
    );
    expect(html).toContain("Нет локальных правок");
    expect(html).not.toContain("Обновить из Git");
    expect(html).not.toContain('href="https://git.example/mr"');
    expect(html.match(/href="\/projects\/project\/reviews\?review=mr"/g)).toHaveLength(1);
    expect(html.match(/Открыть документы/g)).toHaveLength(1);
    expect(html).toContain(reason === "conflict" ? "Разрешить конфликты" : "Обновить ветку");
  },
);

it("opens resolution directly when the review branch has no saved changes", async () => {
  repository.listDraftFiles.mockResolvedValueOnce([]);
  repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
  const view = await ChangesPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ resolve: "mr" }),
  });
  expect(view.type).toBe(BranchConflictResolver);
  expect(view.props.branch).toBe("fix");
});

it("keeps recovery of a prepared update available after the MR closes", async () => {
  repository.findOpenChangeRequestByBranch.mockResolvedValueOnce(undefined as never);
  repository.getActiveReviewBranchUpdate.mockResolvedValueOnce({
    kind: "branch.update",
    payload: {
      reviewId: "mr",
      strategy: "rebase",
      expectedHeadSha: "original-head",
      preparedUpdate: {},
    },
  });
  repository.listChangeRequests.mockResolvedValueOnce([
    {
      id: "mr",
      state: "merged",
      head_sha: null,
      source_branch: "fix",
      target_branch: "release",
      provider_url: "https://git.example/mr",
      details: null,
    },
  ] as never);
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html).toContain("Продолжить обновление ветки");
  expect(html).not.toContain("Ветка отстаёт");
  const reviewLink = html.match(/<a\b[^>]*href="https:\/\/git.example\/mr"[^>]*>/)?.[0];
  expect(reviewLink).toContain('target="_blank"');
  expect(reviewLink).toContain('rel="noreferrer"');
  expect(html).not.toContain('href="/projects/project/reviews?review=mr"');
});

it("shows branch conflicts and the resolver even when no local files have changed", async () => {
  repository.listDraftFiles.mockResolvedValueOnce([]);
  repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
  repository.findOpenChangeRequestByBranch.mockResolvedValueOnce({
    id: "mr",
    source_branch: "fix",
    target_branch: "release",
    state: "open",
    title: "Update docs",
    details: { readiness: { state: "blocked", reason: "conflict" }, source: { isFork: false } },
  });
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html).toContain("Ветка конфликтует с release");
  expect(html).toContain("Разрешить конфликты");
  expect(html).toContain('href="/projects/project/changes?branch=fix&amp;resolve=mr"');
  expect(html).toContain("Нет локальных правок");
  expect(html).not.toContain("Все изменения отправлены");
});

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

it("renders branch loading before accessing changes for an unknown branch", async () => {
  repository.listBranches.mockResolvedValueOnce([]);
  const reads = repository.listChangedWorkingFiles.mock.calls.length;
  const view = await ChangesPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "doc/790" }),
  });
  expect(view.type).toBe(BranchImport);
  expect(view.props).toEqual({ projectId: "project", branch: "doc/790" });
  expect(repository.listChangedWorkingFiles.mock.calls.length).toBe(reads);
});

it("keeps a catalog-only branch loading instead of offering to create an MR", async () => {
  repository.listDraftFiles.mockResolvedValueOnce([]);
  repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
  repository.listChangedWorkingFiles.mockResolvedValueOnce({
    branch: { repository_paths: [] },
    files: [],
  });
  repository.hasImportedBranch.mockResolvedValueOnce(false);
  const view = await ChangesPage({
    params: Promise.resolve({ projectId: "project" }),
    searchParams: Promise.resolve({ branch: "fix" }),
  });
  expect(view.type).toBe(BranchImport);
});

it("opens changes for a successfully imported empty repository", async () => {
  repository.listDraftFiles.mockResolvedValueOnce([]);
  repository.listAttachmentsForBranch.mockResolvedValueOnce([]);
  repository.listChangedWorkingFiles.mockResolvedValueOnce({
    branch: { repository_paths: [] },
    files: [],
  });
  const html = renderToStaticMarkup(
    await ChangesPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ branch: "fix" }),
    }),
  );
  expect(html).toContain("Все изменения отправлены");
  expect(repository.hasImportedBranch).toHaveBeenLastCalledWith("branch");
});
