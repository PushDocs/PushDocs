import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
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
  application: () => ({ listProjects: async () => [{ id: "project" }] }),
  repository: () => ({
    requireProjectAccess: mocks.access,
    listChangeRequests: async () => mocks.reviews,
    listChecks: async () => [],
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import ReviewsPage from "./page";

it("opens the selected review source branch, including URL special characters", async () => {
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain('href="/projects/project/documents?branch=docs%2Ffix+%231"');
  expect(html).toContain("Редактировать ветку");
  expect(html).not.toContain("documents?branch=stable");
  expect(mocks.access).toHaveBeenCalledWith("user", "project");
});
it("labels the branch action as viewing for readers", async () => {
  mocks.access.mockResolvedValueOnce({ role: "reader" });
  const html = renderToStaticMarkup(
    await ReviewsPage({
      params: Promise.resolve({ projectId: "project" }),
      searchParams: Promise.resolve({ review: "selected" }),
    }),
  );
  expect(html).toContain("Открыть ветку");
  expect(html).not.toContain("Редактировать ветку");
});
