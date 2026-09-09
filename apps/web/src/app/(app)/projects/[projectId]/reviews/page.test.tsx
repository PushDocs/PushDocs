// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checks: vi.fn().mockResolvedValue([]),
  access: vi.fn().mockResolvedValue({ role: "editor" }),
  reviews: [
    {
      id: "first",
      source_branch: "other",
      target_branch: "stable",
      title: "Other",
      head_sha: "sha",
      provider_url: "https://git.example/1",
    },
    {
      id: "selected",
      source_branch: "docs/fix #1",
      target_branch: "stable",
      title: "Selected",
      head_sha: "sha",
      provider_url: "https://git.example/2",
    },
  ],
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: "user" }),
  actor: (user: unknown) => user,
  application: () => ({ listProjects: async () => [{ id: "project", provider: "gitlab" }] }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    listChangeRequests: async () => mocks.reviews,
    listChecks: mocks.checks,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ReviewsPage from "./page";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
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
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
  expect(html).toContain("Открыть MR в GitLab");
  expect(html).not.toContain("Перейти к слиянию");
  expect(html).not.toContain("Готовность к слиянию");
  expect(html).not.toContain("Обязательные проверки пройдены");
  expect(html.match(/href="https:\/\/git.example\/2"/g)).toHaveLength(1);
  expect(html).not.toContain("Отправить изменения");
  expect(html).not.toContain("Получить из Git");
  expect(html).not.toContain("disabled");
});
it("provides an explicit branch switch for readers too", async () => {
  mocks.access.mockResolvedValueOnce({ role: "reader" });
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain("Переключиться на ветку");
  expect(html).not.toContain("Редактировать ветку");
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
