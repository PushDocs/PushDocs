import { afterEach, expect, it, vi } from "vitest";
import { GitHubProvider, GitLabProvider } from "./index";

const json = (value: unknown) => new Response(JSON.stringify(value));
afterEach(() => vi.unstubAllGlobals());

it("reads the GitLab commit date from the existing paginated branch response", async () => {
  const fetcher = vi.fn(async () =>
    json([
      { name: "docs", commit: { id: "head", committed_date: "2026-11-15T12:00:00Z" } },
      { name: "undated", commit: { id: "other" } },
    ]),
  );
  vi.stubGlobal("fetch", fetcher);
  expect(await new GitLabProvider("https://gitlab.test", "token").listBranches("42")).toEqual([
    { name: "docs", sha: "head", lastCommitAt: "2026-11-15T12:00:00Z" },
    { name: "undated", sha: "other" },
  ]);
  expect(fetcher).toHaveBeenCalledOnce();
});

it.each(["gitlab", "github"])(
  "identifies local, fork and unknown review sources for %s",
  async (kind) => {
    const rows = [42, 99, null].map((sourceId, index) =>
      kind === "gitlab"
        ? {
            iid: index + 1,
            source_project_id: sourceId,
            target_project_id: 42,
            source_branch: "docs",
            target_branch: "main",
            state: "merged",
          }
        : {
            number: index + 1,
            head: { ref: "docs", sha: "head", repo: sourceId ? { id: sourceId } : null },
            base: { ref: "main", repo: { id: 42 } },
            state: "closed",
            merged_at: "2026-11-15T12:00:00Z",
          },
    );
    const fetcher = vi.fn(async () => json(rows));
    vi.stubGlobal("fetch", fetcher);
    const provider =
      kind === "gitlab"
        ? new GitLabProvider("https://gitlab.test", "token")
        : new GitHubProvider("https://github.com", "token");
    const reviews = await provider.listChangeRequests("42", "all");
    expect(reviews.map((review) => review.sourceBranchIsLocal)).toEqual([true, false, undefined]);
    expect(reviews.map((review) => review.state)).toEqual(["merged", "merged", "merged"]);
    expect(fetcher).toHaveBeenCalledOnce();
  },
);
it.each(["gitlab", "github"])("exposes branch protection for %s", async (kind) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json([{ name: "main", commit: { id: "sha", sha: "sha" }, protected: true }])),
  );
  const provider =
    kind === "gitlab"
      ? new GitLabProvider("https://gitlab.test", "token")
      : new GitHubProvider("https://github.com", "token");
  expect(await provider.listBranches("docs")).toEqual([
    { name: "main", sha: "sha", protected: true },
  ]);
});

it.each(["gitlab", "github"])("loads all 131 branches from %s", async (kind) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: URL) => {
      const page = Number(new URL(url).searchParams.get("page") ?? 1);
      return json(
        Array.from({ length: page === 1 ? 100 : 31 }, (_, i) => ({
          name: `article/${(page - 1) * 100 + i}`,
          commit: { id: "head", sha: "head" },
        })),
      );
    }),
  );
  const provider =
    kind === "gitlab"
      ? new GitLabProvider("https://gitlab.test", "token")
      : new GitHubProvider("https://github.com", "token");
  const branches = await provider.listBranches("docs");
  expect(branches).toHaveLength(131);
  expect(branches[130]).toEqual({ name: "article/130", sha: "head" });
});

it("creates a GitLab branch from an immutable revision", async () => {
  const fetcher = vi.fn(async (_url, init) => {
    expect(JSON.parse(init.body)).toEqual({ branch: "docs/new-article", ref: "abc123" });
    return json({ name: "docs/new-article", commit: { id: "abc123" } });
  });
  vi.stubGlobal("fetch", fetcher);
  const provider = new GitLabProvider("https://gitlab.test", "token");
  expect(await provider.createBranch("9", "docs/new-article", "abc123")).toEqual({
    name: "docs/new-article",
    sha: "abc123",
  });
});

it("rejects invalid branch names before contacting a provider", async () => {
  const provider = new GitLabProvider("https://gitlab.test", "token");
  await expect(provider.createBranch("9", "bad..ref", "sha")).rejects.toThrow();
});

it("creates a GitHub ref at the requested SHA", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url, input) => {
      expect(JSON.parse(input.body)).toEqual({ ref: "refs/heads/docs/new", sha: "abc" });
      return json({ ref: "refs/heads/docs/new", object: { sha: "abc" } });
    }),
  );
  expect(
    await new GitHubProvider("https://github.com", "token").createBranch(
      "org/repo",
      "docs/new",
      "abc",
    ),
  ).toEqual({ name: "docs/new", sha: "abc" });
});
it.each(["gitlab", "github"])("reads binary files losslessly from %s", async (kind) => {
  const bytes = new Uint8Array([0, 255, 128, 1]);
  const mock = vi.fn(async (_url: RequestInfo | URL) => new Response(bytes));
  vi.stubGlobal("fetch", mock);
  const provider =
    kind === "gitlab"
      ? new GitLabProvider("https://gitlab.test", "token")
      : new GitHubProvider("https://github.com", "token");
  expect(await provider.readBinary("org/repo", "immutable-sha", "static/img/a b.png")).toEqual(
    Buffer.from(bytes),
  );
  expect(String(mock.mock.calls[0]?.[0])).toContain("ref=immutable-sha");
});
it("rejects unavailable and oversized provider files", async () => {
  const mock = vi
    .fn()
    .mockResolvedValueOnce(new Response(null, { status: 404 }))
    .mockResolvedValueOnce(new Response(null))
    .mockResolvedValueOnce(
      new Response("x", { headers: { "Content-Length": String(65 * 1024 * 1024) } }),
    )
    .mockResolvedValueOnce(new Response(new Uint8Array(65 * 1024 * 1024)));
  vi.stubGlobal("fetch", mock);
  const provider = new GitLabProvider("https://gitlab.test", "token");
  await expect(provider.readBinary("9", "sha", "a")).rejects.toThrow("404");
  for (let i = 0; i < 3; i++)
    await expect(provider.readBinary("9", "sha", "a")).rejects.toThrow("size limit");
});

it("bounds a provider that never terminates pagination", async () => {
  const rows = Array.from({ length: 100 }, () => ({ name: "branch", commit: { id: "sha" } }));
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => json(rows)),
  );
  await expect(
    new GitLabProvider("https://gitlab.test", "token").listBranches("9"),
  ).rejects.toThrow("pagination limit");
});
