// @vitest-environment jsdom
import { BranchUpdateStrategy } from "@pushdocs/contracts";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../../../../../../tests/fixtures/branch-update-policy";

const mocks = vi.hoisted(() => {
  const reviews = [
    {
      id: "first",
      external_id: "1",
      source_branch: "other",
      target_branch: "stable",
      title: "Other",
      head_sha: "sha",
      provider_url: "https://git.example/1",
      state: "open",
      details: {
        headSha: "sha",
        readiness: { state: "unknown", reason: null },
        labels: null,
        approvals: null,
        comments: null,
        commentsComplete: false,
        source: { repositoryId: "main", isFork: false, branchUrl: null },
      },
    },
    {
      id: "selected",
      external_id: "42",
      source_branch: "docs/fix #1",
      target_branch: "stable",
      title: "Selected",
      head_sha: "sha",
      provider_url: "https://git.example/2",
      state: "open",
      details: {
        headSha: "sha",
        readiness: { state: "unknown", reason: null },
        labels: null,
        approvals: null,
        comments: null,
        commentsComplete: false,
        source: { repositoryId: "main", isFork: false, branchUrl: null },
      },
    },
    {
      id: "merged",
      external_id: "43",
      source_branch: "docs/done",
      target_branch: "stable",
      title: "Already merged",
      head_sha: "sha",
      provider_url: "https://git.example/3",
      state: "merged",
    },
  ];
  return {
    activeUpdate: vi.fn(),
    blockers: vi.fn().mockResolvedValue({ paths: [], busy: false }),
    start: vi.fn(),
    status: vi.fn(),
    refresh: vi.fn(),
    inspectConflicts: vi.fn(),
    checks: vi.fn().mockResolvedValue([]),
    project: vi.fn().mockResolvedValue({
      id: "project",
      provider: "gitlab",
      role: "editor",
      defaultBranch: "stable",
    }),
    reviews,
    listReviews: vi.fn(async (_projectId: string, state?: string) =>
      reviews.filter((review) => !state || review.state === state),
    ),
  };
});
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (user: unknown) => user,
  repository: () => ({
    getProjectForUser: mocks.project,
    listChangeRequests: mocks.listReviews,
    listChecks: mocks.checks,
    getActiveReviewBranchUpdate: mocks.activeUpdate,
    getBranchConflictBlockers: mocks.blockers,
  }),
}));

vi.mock("@/app/conflict-actions", () => ({
  inspectReviewConflictsAction: mocks.inspectConflicts,
  prepareConflictResolutionAction: vi.fn(),
  submitConflictResolutionAction: vi.fn(),
  retryConflictResolutionAction: vi.fn(),
}));
vi.mock("@/app/actions", () => ({
  startGitOperationAction: mocks.start,
  gitOperationStatusAction: mocks.status,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));

import { draftKey, writeDraft } from "@/components/draft-storage";
import { gitOperationStore } from "@/components/git-operation-store";
import ReviewsPage from "./page";

afterEach(() => {
  cleanup();
  gitOperationStore.clear();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllEnvs();
  mocks.checks.mockReset().mockResolvedValue([]);
  mocks.blockers.mockReset().mockResolvedValue({ paths: [], busy: false });
  mocks.start.mockReset();
  mocks.status.mockReset();
});

it("opens the external preview only after its current deploy check succeeds", async () => {
  vi.stubEnv("PUSHDOCS_PREVIEW_URL", "https://pr-{MR_NUMBER}.docs.example.test/");
  mocks.checks.mockResolvedValueOnce([
    { id: "preview", name: "preview:deploy", conclusion: "success", required: false },
  ]);
  const ready = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(ready).toContain('href="https://pr-42.docs.example.test/"');
  expect(ready).toContain("Открыть предпросмотр");

  mocks.checks.mockResolvedValueOnce([
    { id: "preview", name: "preview:deploy", conclusion: "running", required: false },
  ]);
  const pending = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(pending).not.toContain('href="https://pr-42.docs.example.test/"');
  expect(pending).toContain("Предпросмотр обновляется");
});

it("renders a review without a head commit and keeps the preview unavailable", async () => {
  vi.stubEnv("PUSHDOCS_PREVIEW_URL", "https://pr-{MR_NUMBER}.docs.example.test/");
  mocks.listReviews.mockResolvedValueOnce([
    { ...mocks.reviews[0], head_sha: null, details: null },
  ] as never);
  mocks.checks.mockResolvedValueOnce([
    { id: "old-preview", name: "preview:deploy", conclusion: "success", required: false },
  ]);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );

  expect(screen.getByText("Коммит недоступен")).toBeTruthy();
  expect(mocks.checks).not.toHaveBeenCalled();
  expect(screen.queryByRole("link", { name: "Открыть предпросмотр" })).toBeNull();
  expect(screen.getByText("Нет данных")).toBeTruthy();
});

it("opens the selected review source branch, including URL special characters", async () => {
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain('href="/projects/project/documents?branch=docs%2Ffix+%231"');
  expect(html).toContain("Переключиться на ветку");
  expect(html).not.toContain("documents?branch=stable");
  expect(mocks.project).toHaveBeenCalledWith("user", "project");
  expect(html).toContain("Открыть MR в GitLab");
  expect(html).not.toContain("Перейти к слиянию");
  expect(html).toContain("Готовность к слиянию");
  expect(html).not.toContain("Обязательные проверки пройдены");
  expect(html.match(/href="https:\/\/git.example\/2"/g)).toHaveLength(1);
  expect(html).not.toContain("Отправить изменения");
  expect(html).toContain("Обновить данные MR");
  expect(html).not.toContain("Обновить файлы");
  expect(html).not.toContain("disabled");
});
it("provides an explicit branch switch for readers too", async () => {
  mocks.project.mockResolvedValueOnce({ id: "project", provider: "gitlab", role: "reader" });
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain("Переключиться на ветку");
  expect(html).not.toContain("Редактировать ветку");
});

it.each(["need_rebase", "behind", "conflict", "dirty"])(
  "places the branch action beside the provider link for its %s blocker",
  async (reason) => {
    mocks.listReviews.mockResolvedValueOnce([
      mocks.reviews[0],
      {
        ...mocks.reviews[1],
        target_branch: "release",
        details: {
          ...mocks.reviews[1]?.details,
          readiness: { state: "blocked", reason },
          branchUpdatePolicy: resolvedBranchUpdatePolicy(),
        },
      },
    ] as never);
    render(
      await ReviewsPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({ review: "selected" }),
      }),
    );
    const hasConflicts = reason === "conflict" || reason === "dirty";
    const notice = screen.getByRole(hasConflicts ? "region" : "group", { name: "Состояние ветки" });
    expect(notice.closest(hasConflicts ? ".review-heading" : ".review-actions")).toBeTruthy();
    expect(Boolean(document.querySelector(".review-heading .branch-notice"))).toBe(
      reason === "conflict" || reason === "dirty",
    );
    if (!hasConflicts)
      expect(notice.previousElementSibling).toBe(
        screen.getByRole("link", { name: "Открыть MR в GitLab" }),
      );
    expect(notice.textContent).toContain(
      reason === "conflict" || reason === "dirty" ? "Исправить конфликты" : "Обновить ветку",
    );
    expect(notice.textContent).not.toContain("release");
    if (reason === "conflict" || reason === "dirty") {
      expect(
        within(notice).getByRole("link", { name: "Исправить конфликты" }).getAttribute("href"),
      ).toBe("/projects/project/changes?branch=docs%2Ffix+%231&resolve=selected");
    } else {
      expect(within(notice).getByRole("button", { name: "Обновить ветку" })).toHaveProperty(
        "disabled",
        false,
      );
    }
    expect(screen.queryByRole("link", { name: "Перейти к изменениям" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Обновить список конфликтов" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Готовность к слиянию" })).toBeNull();
    expect(mocks.inspectConflicts).not.toHaveBeenCalled();
    expect(screen.getAllByRole("link", { name: "Открыть MR в GitLab" })).toHaveLength(1);
    expect(
      within(screen.getByRole("navigation", { name: "Список MR" })).getByText(
        reason === "conflict" || reason === "dirty" ? "Исправить конфликты" : "Обновить ветку",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Обновить данные MR" })).toBeTruthy();
    expect(screen.queryByText("Нужно обновить ветку относительно основной.")).toBeNull();
  },
);

it.each([
  { status: "running", title: "Обновить ветку" },
  { status: "needs_resolution", title: "Исправить конфликты" },
])("shows the next editor action for an unfinished $status update", async ({ status, title }) => {
  mocks.activeUpdate.mockResolvedValueOnce({ status, payload: { strategy: "rebase" } });
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  const notice = within(
    screen.getByRole(status === "needs_resolution" ? "region" : "group", {
      name: "Состояние ветки",
    }),
  );
  expect(notice.getByText(title)).toBeTruthy();
  expect(
    status === "needs_resolution"
      ? notice.getByRole("link", { name: "Исправить конфликты" })
      : notice.getByRole("button", { name: "Обновить ветку" }),
  ).toBeTruthy();
});

async function renderUpdateReview(reason = "behind", strategy = BranchUpdateStrategy.Merge) {
  mocks.listReviews.mockResolvedValueOnce([
    {
      ...mocks.reviews[1],
      details: {
        ...mocks.reviews[1]?.details,
        readiness: { state: "blocked", reason },
        branchUpdatePolicy: resolvedBranchUpdatePolicy({ strategy }),
      },
    },
  ] as never);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  return within(
    screen.getByRole(reason === "conflict" ? "region" : "group", { name: "Состояние ветки" }),
  );
}

it("updates the selected MR's branch in place without changing the working branch", async () => {
  sessionStorage.setItem("pushdocs:branch:project", "other");
  mocks.start.mockResolvedValue("update");
  mocks.status.mockResolvedValue({ status: "done" });
  const notice = await renderUpdateReview();
  fireEvent.click(notice.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(mocks.start).toHaveBeenCalledOnce();
  expect(mocks.start).toHaveBeenCalledWith({
    projectId: "project",
    branch: "docs/fix #1",
    updateReview: {
      reviewId: "selected",
      expectedHeadSha: "sha",
      expectedStrategy: resolvedBranchUpdatePolicy().strategy,
    },
  });
  expect(mocks.refresh).toHaveBeenCalledOnce();
  expect(screen.getByRole("status").textContent).toBe("Ветка обновлена.");
  expect(sessionStorage.getItem("pushdocs:branch:project")).toBe("other");
});

it("updates a conflicted rebase before offering to resolve its paused commit", async () => {
  mocks.start.mockResolvedValue("update");
  mocks.status.mockResolvedValue({ status: "needs_resolution" });
  const actions = await renderUpdateReview("conflict", BranchUpdateStrategy.Rebase);
  expect(actions.getByRole("heading", { name: "Есть конфликты" })).toBeTruthy();
  expect(actions.queryByRole("link", { name: "Исправить конфликты" })).toBeNull();
  fireEvent.click(actions.getByRole("button", { name: "Обновить ветку" }));
  await act(async () => {});
  expect(await screen.findByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
  expect(
    within(screen.getByRole("region", { name: "Состояние ветки" })).queryByRole("button", {
      name: "Обновить ветку",
    }),
  ).toBeNull();
  expect(mocks.start).toHaveBeenCalledOnce();
});

it("opens saved changes instead of starting an update from the MR", async () => {
  mocks.blockers.mockResolvedValueOnce({ paths: ["docs/a.md"], busy: false });
  const notice = await renderUpdateReview();
  expect(mocks.blockers).toHaveBeenCalledWith("project", "docs/fix #1");
  expect(notice.getByRole("link", { name: "Открыть правки" }).getAttribute("href")).toBe(
    "/projects/project/changes?branch=docs%2Ffix+%231",
  );
  expect(notice.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("opens browser drafts instead of starting an update from the MR", async () => {
  writeDraft(draftKey("project", "docs/fix #1", "docs/a.md", "user"), "Draft", "Base");
  const notice = await renderUpdateReview();
  expect(notice.getByRole("link", { name: "Открыть правки" }).getAttribute("href")).toBe(
    "/projects/project/documents?branch=docs%2Ffix+%231",
  );
  expect(notice.queryByRole("button", { name: "Обновить ветку" })).toBeNull();
  expect(mocks.start).not.toHaveBeenCalled();
});

it("disables updating from the MR for readers", async () => {
  mocks.project.mockResolvedValueOnce({
    id: "project",
    provider: "gitlab",
    role: "reader",
    defaultBranch: "stable",
  });
  const notice = await renderUpdateReview();
  expect(notice.getByRole("button", { name: "Обновить ветку" })).toHaveProperty("disabled", true);
  expect(mocks.start).not.toHaveBeenCalled();
});

it.each(["reader", "editor"])("respects conflict permissions for a %s", async (role) => {
  mocks.project.mockResolvedValueOnce({
    id: "project",
    provider: "gitlab",
    role,
    defaultBranch: "stable",
  });
  mocks.listReviews.mockResolvedValueOnce([
    {
      ...mocks.reviews[1],
      details: {
        ...mocks.reviews[1]?.details,
        readiness: { state: "blocked", reason: "conflict" },
        branchUpdatePolicy: resolvedBranchUpdatePolicy(),
      },
    },
  ] as never);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  const notice = within(screen.getByRole("region", { name: "Состояние ветки" }));
  if (role === "reader")
    expect(notice.getByRole("button", { name: "Исправить конфликты" })).toHaveProperty(
      "disabled",
      true,
    );
  else expect(notice.getByRole("link", { name: "Исправить конфликты" })).toBeTruthy();
  expect(mocks.inspectConflicts).not.toHaveBeenCalled();
  expect(mocks.start).not.toHaveBeenCalled();
});

it.each([true, undefined])(
  "does not open changes for an unavailable source (%s)",
  async (isFork) => {
    mocks.listReviews.mockResolvedValueOnce([
      {
        ...mocks.reviews[1],
        details: {
          ...mocks.reviews[1]?.details,
          source: isFork ? { isFork, repositoryId: "fork", branchUrl: null } : undefined,
          readiness: { state: "blocked", reason: "behind" },
        },
      },
    ] as never);
    render(
      await ReviewsPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({}),
      }),
    );
    expect(screen.getByRole("group", { name: "Состояние ветки" })).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Перейти к изменениям" })).toBeNull();
  },
);

it("separates the working branch's MR above the list without changing the selection", async () => {
  sessionStorage.setItem("pushdocs:branch:project", "docs/fix #1");
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  const list = within(screen.getByRole("navigation", { name: "Список MR" }));
  const current = within(list.getByRole("region", { name: "MR текущей ветки" }));
  expect(current.getByRole("heading", { name: "Текущая ветка" })).toBeTruthy();
  expect(current.getByRole("link", { name: /^Selected/ }).getAttribute("href")).toBe(
    "?review=selected",
  );
  expect(list.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "?review=selected",
    "?review=first",
  ]);
  expect(current.queryByText("Other")).toBeNull();
  expect(list.getByRole("heading", { name: "Текущая ветка" }).closest("a")).toBeNull();
  expect(screen.queryByRole("link", { name: "Переключиться на ветку" })).toBeNull();
  act(() => {
    sessionStorage.setItem("pushdocs:branch:project", "other");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  expect(
    within(list.getByRole("region", { name: "MR текущей ветки" }))
      .getByRole("link", { name: /^Other/ })
      .getAttribute("href"),
  ).toBe("?review=first");
  expect(list.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
    "?review=first",
    "?review=selected",
  ]);
  expect(screen.getByRole("link", { name: "Переключиться на ветку" })).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Selected" })).toBeTruthy();
  act(() => {
    sessionStorage.setItem("pushdocs:branch:project", "docs/new");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  expect(list.queryByRole("region", { name: "MR текущей ветки" })).toBeNull();
  expect(list.getAllByRole("link")).toHaveLength(2);
});

it.each([
  { provider: "gitlab", label: "MR" },
  { provider: "github", label: "PR" },
])("quietly explains a missing $label for the working branch", async ({ provider, label }) => {
  mocks.project.mockResolvedValueOnce({
    id: "project",
    provider,
    role: "editor",
    defaultBranch: "stable",
  });
  sessionStorage.setItem("pushdocs:branch:project", "docs/new #1");
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected", branch: "docs/fix #1" }),
    }),
  );
  const notice = within(screen.getByRole("note", { name: `${label} текущей ветки` }));
  expect(notice.getByText("docs/new #1")).toBeTruthy();
  expect(notice.getByText(new RegExp(`нет открытого ${label}`))).toBeTruthy();
  expect(notice.getByRole("link", { name: "К изменениям" }).getAttribute("href")).toBe(
    "/projects/project/changes?branch=docs%2Fnew+%231",
  );
  expect(screen.getByRole("heading", { name: "Selected" })).toBeTruthy();
  act(() => {
    sessionStorage.setItem("pushdocs:branch:project", "other");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  expect(screen.queryByRole("note")).toBeNull();
  act(() => {
    sessionStorage.setItem("pushdocs:branch:project", "docs/another");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  expect(screen.getByRole("note").textContent).toContain("docs/another");
  act(() => {
    sessionStorage.setItem("pushdocs:branch:project", "stable");
    window.dispatchEvent(new Event("pushdocs:context"));
  });
  expect(screen.queryByRole("note")).toBeNull();
});

it("shows the current branch notice alongside the empty review list", async () => {
  mocks.listReviews.mockResolvedValueOnce([]);
  sessionStorage.setItem("pushdocs:branch:project", "docs/new");
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.getByRole("note").textContent).toContain("docs/new");
  expect(screen.getByRole("heading", { name: "Нет открытых MR" })).toBeTruthy();
});

it("does not mistake a fork's matching branch name for the working branch's MR", async () => {
  mocks.listReviews.mockResolvedValueOnce([
    {
      ...mocks.reviews[1],
      details: {
        ...mocks.reviews[1]?.details,
        source: { isFork: true, repositoryId: "fork", branchUrl: null },
      },
    },
  ] as never);
  sessionStorage.setItem("pushdocs:branch:project", "docs/fix #1");
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.getByRole("note").textContent).toContain("docs/fix #1");
  expect(screen.queryByText("Текущая ветка")).toBeNull();
  expect(screen.queryByRole("region", { name: "MR текущей ветки" })).toBeNull();
});

it("waits for source information before declaring a matching MR missing", async () => {
  mocks.listReviews.mockResolvedValueOnce([{ ...mocks.reviews[1], details: null }] as never);
  sessionStorage.setItem("pushdocs:branch:project", "docs/fix #1");
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.queryByRole("note")).toBeNull();
  expect(screen.queryByRole("region", { name: "MR текущей ветки" })).toBeNull();
});

it("keeps individual check results visible without a separate merge panel", async () => {
  mocks.checks.mockResolvedValueOnce([
    { id: "one", name: "checks", conclusion: "success", required: true },
    { id: "two", name: "deploy", conclusion: "failure", required: true },
    { id: "three", name: "preview", conclusion: "running", required: false },
  ]);
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain("Пройдена");
  expect(html).toContain("Ошибка");
  expect(html).toContain("Выполняется");
  expect(html).toContain("Обязательная");
  expect(html).not.toContain("merge-panel");
});

it("browses MR details without changing the working branch", async () => {
  sessionStorage.setItem("pushdocs:branch:project", "my-work");
  const view = render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "first" }),
    }),
  );
  expect(sessionStorage.getItem("pushdocs:branch:project")).toBe("my-work");
  view.rerender(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected", branch: "unrelated" }),
    }),
  );
  expect(sessionStorage.getItem("pushdocs:branch:project")).toBe("my-work");
  expect(screen.getByRole("link", { name: "Переключиться на ветку" }).getAttribute("href")).toBe(
    "/projects/project/documents?branch=docs%2Ffix+%231",
  );
  expect(screen.getByRole("link", { name: /^Other/ }).getAttribute("href")).toBe("?review=first");
});

it("shows only open reviews without search or state filters", async () => {
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ q: "42", state: "merged" }),
    }),
  );
  expect(mocks.listReviews).toHaveBeenLastCalledWith("project");
  expect(screen.queryByText("Найти MR")).toBeNull();
  expect(screen.queryByText("Все состояния")).toBeNull();
  expect(screen.getByRole("link", { name: /^Other/ })).toBeTruthy();
  expect(screen.getByRole("link", { name: /^Selected/ }).getAttribute("href")).toBe(
    "?review=selected",
  );
  expect(screen.queryByText("Already merged")).toBeNull();
});

it("explains when there are no open reviews", async () => {
  mocks.listReviews.mockResolvedValueOnce([]);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.getByText("Нет открытых MR")).toBeTruthy();
  expect(screen.getByText(/Здесь отображаются открытые MR проекта/)).toBeTruthy();
});

it.each([
  { provider: "gitlab", label: "MR", state: "merged", result: "влит в" },
  { provider: "github", label: "PR", state: "merged", result: "влит в" },
  { provider: "gitlab", label: "MR", state: "closed", result: "закрыт без слияния" },
])(
  "shows the $state $label of the current branch without a creation prompt",
  async ({ provider, label, state, result }) => {
    mocks.project.mockResolvedValueOnce({
      id: "project",
      provider,
      role: "editor",
      defaultBranch: "stable",
    });
    mocks.listReviews.mockResolvedValueOnce([
      ...mocks.reviews.filter((review) => review.state === "open"),
      { ...mocks.reviews[2], state },
    ] as never);
    sessionStorage.setItem("pushdocs:branch:project", "docs/done");
    render(
      await ReviewsPage({
        params: Promise.resolve({ projectId: "project" }),
        searchParams: Promise.resolve({}),
      }),
    );
    const notice = within(screen.getByRole("note", { name: `${label} текущей ветки` }));
    expect(notice.getByText("docs/done")).toBeTruthy();
    expect(screen.getByRole("note").textContent).toContain(result);
    expect(notice.getByRole("link", { name: `Открыть ${label}` }).getAttribute("href")).toBe(
      "https://git.example/3",
    );
    expect(notice.queryByText("К изменениям")).toBeNull();
    expect(notice.queryByText(/нет открытого/)).toBeNull();
    act(() => {
      sessionStorage.setItem("pushdocs:branch:project", "other");
      window.dispatchEvent(new Event("pushdocs:context"));
    });
    expect(screen.queryByRole("note")).toBeNull();
  },
);

it("does not claim readiness or a running preview when checks are absent", async () => {
  vi.stubEnv("PUSHDOCS_PREVIEW_URL", "https://pr-{MR_NUMBER}.docs.example.test/");
  mocks.checks.mockResolvedValueOnce([]);
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).not.toContain("Готово");
  expect(html).not.toContain("Предпросмотр обновляется");
  expect(html).toContain("Нет данных");
});

it("shows readiness on every open review and keeps missing provider data unknown even when checks pass", async () => {
  mocks.checks.mockResolvedValueOnce([
    { id: "ci", name: "checks", conclusion: "success", required: true },
  ]);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  const list = within(screen.getByRole("navigation", { name: "Список MR" }));
  expect(list.getAllByText("Готовность неизвестна")).toHaveLength(2);
  expect(screen.getByRole("region", { name: "Готовность к слиянию" }).textContent).toContain(
    "Готовность неизвестна",
  );
  expect(screen.queryByText("Готов к слиянию")).toBeNull();
});

it("does not import a fork branch into the main project's workspace", async () => {
  mocks.listReviews.mockResolvedValueOnce([
    {
      ...mocks.reviews[1],
      details: {
        ...mocks.reviews[1]?.details,
        source: {
          repositoryId: "fork",
          isFork: true,
          branchUrl: "https://git.example/fork/-/tree/doc%2F790",
        },
      },
    },
  ] as never);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.queryByRole("link", { name: "Переключиться на ветку" })).toBeNull();
  expect(screen.queryByRole("link", { name: /Открыть ветку в GitLab/ })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Переключиться на ветку" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Ветка находится в форке/)).toBeTruthy();
});

it("explains when the fork is unavailable instead of offering an import", async () => {
  mocks.listReviews.mockResolvedValueOnce([
    {
      ...mocks.reviews[1],
      details: {
        ...mocks.reviews[1]?.details,
        source: { repositoryId: null, isFork: true, branchUrl: null },
      },
    },
  ] as never);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.queryByRole("link", { name: "Переключиться на ветку" })).toBeNull();
  expect(screen.queryByRole("link", { name: /Открыть ветку в GitLab/ })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Переключиться на ветку" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Исходный репозиторий удалён или недоступен/)).toBeTruthy();
});

it("requires refreshing old reviews before opening an unidentified source repository", async () => {
  mocks.listReviews.mockResolvedValueOnce([{ ...mocks.reviews[1], details: null }] as never);
  render(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({}),
    }),
  );
  expect(screen.queryByRole("link", { name: "Переключиться на ветку" })).toBeNull();
  expect(
    (screen.getByRole("button", { name: "Переключиться на ветку" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(screen.getByText(/Исходный репозиторий ещё не определён/)).toBeTruthy();
});
