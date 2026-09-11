import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createProvider,
  GitHubProvider,
  GitLabProvider,
  normalizeRepositoryLocator,
  ProviderConflictError,
} from "./index";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider adapters", () => {
  it("accepts repository URLs pasted from GitHub and nested GitLab groups", () => {
    expect(
      normalizeRepositoryLocator(
        "gitlab",
        "https://gitlab.sndsy.ru/sendsay-ru/frontend/sendsay-docs/-/tree/stable",
      ),
    ).toBe("sendsay-ru/frontend/sendsay-docs");
    expect(normalizeRepositoryLocator("github", "https://github.com/acme/docs.git")).toBe(
      "acme/docs",
    );
  });

  it("selects GitLab for self-managed installations", () => {
    expect(
      createProvider({
        baseUrl: "https://gitlab.internal.test",
        kind: "gitlab",
        token: "token",
      }).kind,
    ).toBe("gitlab");
  });

  it("selects GitHub independently from its base URL", () => {
    expect(
      createProvider({ baseUrl: "https://github.com", kind: "github", token: "token" }).kind,
    ).toBe("github");
  });

  it("keeps a GitLab numeric project id as the API locator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          default_branch: "stable",
          http_url_to_repo: "https://gitlab.test/group/docs.git",
          id: 9,
          path_with_namespace: "group/docs",
          web_url: "https://gitlab.test/group/docs",
        }),
      ),
    );
    expect(
      (await new GitLabProvider("https://gitlab.test", "token").getRepository("group/docs")).id,
    ).toBe("9");
  });

  it("keeps a GitHub full name as the API locator", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          clone_url: "https://github.com/acme/docs.git",
          default_branch: "main",
          full_name: "acme/docs",
          html_url: "https://github.com/acme/docs",
          id: 42,
        }),
      ),
    );
    expect(
      (await new GitHubProvider("https://github.com", "token").getRepository("acme/docs")).id,
    ).toBe("acme/docs");
  });

  it("creates a GitHub commit and advances the ref without force", async () => {
    const responses = [
      json({ object: { sha: "a".repeat(40) } }),
      json({ tree: { sha: "base-tree" } }),
      json({ sha: "blob-sha" }, 201),
      json({ sha: "tree-sha" }, 201),
      json({ html_url: "https://github.com/acme/docs/commit/new", sha: "new-sha" }, 201),
      json({ object: { sha: "new-sha" } }),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return responses.shift() ?? json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GitHubProvider("https://github.com", "token").commitFiles({
      branch: "docs/update",
      changes: [{ content: Buffer.from("hello"), operation: "update", path: "docs/index.mdx" }],
      expectedHeadSha: "a".repeat(40),
      message: "Update docs",
      repositoryId: "acme/docs",
    });
    expect(result.sha).toBe("new-sha");
    const update = calls[5];
    expect(String(update?.[0])).toContain("git/refs/heads/docs/update");
    expect(JSON.parse(String(update?.[1]?.body))).toEqual({ force: false, sha: "new-sha" });
  });

  it("rejects a GitHub commit when the branch head changed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ object: { sha: "newer" } })),
    );
    await expect(
      new GitHubProvider("https://github.com", "token").commitFiles({
        branch: "main",
        changes: [],
        expectedHeadSha: "older",
        message: "Update docs",
        repositoryId: "acme/docs",
      }),
    ).rejects.toBeInstanceOf(ProviderConflictError);
  });

  it("sends GitLab files as one base64 batch", async () => {
    const responses = [
      json([{ commit: { id: "head" }, name: "stable" }]),
      json({ last_commit_id: "file-head" }),
      json({ id: "commit", web_url: "https://gitlab.test/acme/docs/-/commit/commit" }, 201),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return responses.shift() ?? json({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await new GitLabProvider("https://gitlab.test", "token").commitFiles({
      branch: "stable",
      changes: [{ content: Buffer.from("Привет"), operation: "update", path: "docs/a.mdx" }],
      expectedHeadSha: "head",
      message: "Документация",
      repositoryId: "42",
    });
    expect(result.sha).toBe("commit");
    const payload = JSON.parse(String(calls[2]?.[1]?.body));
    expect(payload.actions).toEqual([
      {
        action: "update",
        content: Buffer.from("Привет").toString("base64"),
        encoding: "base64",
        file_path: "docs/a.mdx",
        last_commit_id: "file-head",
      },
    ]);
  });
});

describe("GitLab provider", () => {
  it("maps branches and open merge requests", async () => {
    const responses = [
      json([{ commit: { id: "sha-1" }, name: "stable" }]),
      json([
        {
          iid: 7,
          merge_status: "can_be_merged",
          sha: "head",
          source_branch: "docs/update",
          state: "opened",
          target_branch: "stable",
          title: "Update docs",
          web_url: "https://gitlab.test/group/docs/-/merge_requests/7",
        },
      ]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() ?? json([])),
    );
    const provider = new GitLabProvider("https://gitlab.test/", "token");

    await expect(provider.listBranches("42")).resolves.toEqual([{ name: "stable", sha: "sha-1" }]);
    await expect(provider.listChangeRequests("42")).resolves.toEqual([
      {
        headSha: "head",
        id: "7",
        sourceBranch: "docs/update",
        state: "open",
        targetBranch: "stable",
        title: "Update docs",
        url: "https://gitlab.test/group/docs/-/merge_requests/7",
      },
    ]);
  });

  it("returns an existing merge request without creating another", async () => {
    const existing = {
      iid: 7,
      merge_status: "can_be_merged",
      sha: "head",
      source_branch: "docs/update",
      state: "opened",
      target_branch: "stable",
      title: "Existing",
      web_url: "https://gitlab.test/mr/7",
    };
    const fetchMock = vi.fn(async () => json([existing]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      new GitLabProvider("https://gitlab.test", "token").ensureChangeRequest({
        repositoryId: "42",
        sourceBranch: "docs/update",
        targetBranch: "stable",
        title: "New title",
      }),
    ).resolves.toMatchObject({ id: "7", title: "Existing" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a merge request when no matching request exists", async () => {
    const responses = [
      json([]),
      json(
        {
          iid: 8,
          sha: "head",
          source_branch: "docs/new",
          state: "opened",
          target_branch: "stable",
          title: "New docs",
          web_url: "https://gitlab.test/mr/8",
        },
        201,
      ),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([input, init]);
        return responses.shift() ?? json({});
      }),
    );

    await expect(
      new GitLabProvider("https://gitlab.test", "token").ensureChangeRequest({
        repositoryId: "group/docs",
        sourceBranch: "docs/new",
        targetBranch: "stable",
        title: "New docs",
      }),
    ).resolves.toMatchObject({ id: "8", state: "open" });
    expect(String(calls[1]?.[0])).toContain("projects/group%2Fdocs/merge_requests");
    expect(JSON.parse(String(calls[1]?.[1]?.body))).toEqual({
      source_branch: "docs/new",
      target_branch: "stable",
      title: "New docs",
    });
  });

  it("maps pipeline jobs to checks", async () => {
    const responses = [
      json([{ id: 99 }]),
      json([
        {
          allow_failure: false,
          duration: 1.234,
          id: 1,
          name: "test",
          status: "success",
          web_url: "u1",
        },
        { allow_failure: false, duration: 2, id: 2, name: "lint", status: "failed", web_url: "u2" },
        {
          allow_failure: true,
          duration: null,
          id: 3,
          name: "preview",
          status: "skipped",
          web_url: "u3",
        },
        {
          allow_failure: false,
          duration: null,
          id: 4,
          name: "build",
          status: "running",
          web_url: "u4",
        },
      ]),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() ?? json([])),
    );

    await expect(
      new GitLabProvider("https://gitlab.test", "token").listChecks("42", "head"),
    ).resolves.toEqual([
      { conclusion: "success", durationMs: 1234, id: "1", name: "test", required: true, url: "u1" },
      { conclusion: "failure", durationMs: 2000, id: "2", name: "lint", required: true, url: "u2" },
      {
        conclusion: "skipped",
        durationMs: null,
        id: "3",
        name: "preview",
        required: false,
        url: "u3",
      },
      {
        conclusion: "running",
        durationMs: null,
        id: "4",
        name: "build",
        required: true,
        url: "u4",
      },
    ]);
  });

  it("returns no checks when the commit has no pipeline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([])),
    );
    await expect(
      new GitLabProvider("https://gitlab.test", "token").listChecks("42", "head"),
    ).resolves.toEqual([]);
  });

  it("paginates repository files and keeps blobs only", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) => ({
      path: `docs/${index}.md`,
      type: "blob",
    }));
    const responses = [
      json(firstPage),
      json([
        { path: "docs", type: "tree" },
        { path: "last.md", type: "blob" },
      ]),
    ];
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        calls.push(String(input));
        return responses.shift() ?? json([]);
      }),
    );

    const files = await new GitLabProvider("https://gitlab.test", "token").listFiles(
      "group/docs",
      "a/b",
    );
    expect(files).toHaveLength(101);
    expect(files.at(-1)).toBe("last.md");
    expect(calls[1]).toContain("page=2");
    expect(calls[0]).toContain("ref=a%2Fb");
  });

  it("reads raw files and reports a missing file", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("Привет")),
    );
    await expect(
      new GitLabProvider("https://gitlab.test", "token").readFile("42", "main", "docs/a b.md"),
    ).resolves.toBe("Привет");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("missing", { status: 404 })),
    );
    await expect(
      new GitLabProvider("https://gitlab.test", "token").readFile("42", "main", "missing.md"),
    ).rejects.toThrow("GitLab file request failed with 404");
  });

  it("rejects a commit when the branch is missing or GitLab rejects the batch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([])),
    );
    const provider = new GitLabProvider("https://gitlab.test", "token");
    await expect(
      provider.commitFiles({
        branch: "missing",
        changes: [],
        expectedHeadSha: "head",
        message: "Update",
        repositoryId: "42",
      }),
    ).rejects.toBeInstanceOf(ProviderConflictError);

    const responses = [
      json([{ commit: { id: "head" }, name: "main" }]),
      new Response("stale", { status: 409 }),
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => responses.shift() ?? json({})),
    );
    await expect(
      provider.commitFiles({
        branch: "main",
        changes: [{ content: null, operation: "create", path: "empty.md" }],
        expectedHeadSha: "head",
        message: "Update",
        repositoryId: "42",
      }),
    ).rejects.toBeInstanceOf(ProviderConflictError);
  });

  it("sends authentication and JSON headers", async () => {
    const calls: Array<RequestInit | undefined> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        calls.push(init);
        return json({
          default_branch: "main",
          http_url_to_repo: "clone",
          id: 1,
          path_with_namespace: "g/d",
          web_url: "web",
        });
      }),
    );
    await new GitLabProvider("https://gitlab.test", "private-token").getRepository("g/d");
    expect(new Headers(calls[0]?.headers).get("PRIVATE-TOKEN")).toBe("private-token");
  });
});

describe("GitHub provider", () => {
  it("uses the enterprise API and maps branches and pull requests", async () => {
    const responses = [
      json([{ commit: { sha: "sha" }, name: "main" }]),
      json([
        {
          base: { ref: "main" },
          head: { ref: "docs", sha: "head" },
          html_url: "https://github.test/pr/4",
          merged_at: null,
          number: 4,
          state: "open",
          title: "Docs",
        },
      ]),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([input, init]);
        return responses.shift() ?? json([]);
      }),
    );
    const provider = new GitHubProvider("https://github.internal.test", "token");
    await expect(provider.listBranches("acme/docs")).resolves.toEqual([
      { name: "main", sha: "sha" },
    ]);
    await expect(provider.listChangeRequests("acme/docs")).resolves.toEqual([
      {
        headSha: "head",
        id: "4",
        sourceBranch: "docs",
        state: "open",
        targetBranch: "main",
        title: "Docs",
        url: "https://github.test/pr/4",
      },
    ]);
    expect(String(calls[0]?.[0])).toContain("github.internal.test/api/v3/repos/acme/docs/branches");
    expect(new Headers(calls[0]?.[1]?.headers).get("Authorization")).toBe("Bearer token");
  });

  it("creates a pull request only when no matching one exists", async () => {
    const row = {
      base: { ref: "main" },
      head: { ref: "docs/new", sha: "head" },
      html_url: "https://github.com/acme/docs/pull/5",
      number: 5,
      state: "open",
      title: "New docs",
    };
    const responses = [json([]), json(row, 201)];
    const fetchMock = vi.fn(async () => responses.shift() ?? json({}));
    vi.stubGlobal("fetch", fetchMock);
    const provider = new GitHubProvider("https://github.com", "token");
    await expect(
      provider.ensureChangeRequest({
        repositoryId: "acme/docs",
        sourceBranch: "docs/new",
        targetBranch: "main",
        title: "New docs",
      }),
    ).resolves.toMatchObject({ id: "5", sourceBranch: "docs/new" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json([{ ...row, merged_at: null }])),
    );
    await expect(
      provider.ensureChangeRequest({
        repositoryId: "acme/docs",
        sourceBranch: "docs/new",
        targetBranch: "main",
        title: "Ignored",
      }),
    ).resolves.toMatchObject({ id: "5", title: "New docs" });
  });

  it("maps all check conclusions and durations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          check_runs: [
            {
              completed_at: "2026-01-01T00:00:03Z",
              conclusion: "success",
              details_url: "u1",
              id: 1,
              name: "ok",
              started_at: "2026-01-01T00:00:01Z",
              status: "completed",
            },
            {
              completed_at: null,
              conclusion: null,
              details_url: null,
              id: 2,
              name: "run",
              started_at: "2026-01-01T00:00:01Z",
              status: "in_progress",
            },
            {
              completed_at: null,
              conclusion: "skipped",
              details_url: "u3",
              id: 3,
              name: "skip",
              started_at: null,
              status: "completed",
            },
            {
              completed_at: null,
              conclusion: "neutral",
              details_url: "u4",
              id: 4,
              name: "neutral",
              started_at: null,
              status: "completed",
            },
            {
              completed_at: null,
              conclusion: "cancelled",
              details_url: "u5",
              id: 5,
              name: "bad",
              started_at: null,
              status: "completed",
            },
          ],
        }),
      ),
    );
    const checks = await new GitHubProvider("https://github.com", "token").listChecks("a/b", "sha");
    expect(checks.map((item) => item.conclusion)).toEqual([
      "success",
      "running",
      "skipped",
      "neutral",
      "failure",
    ]);
    expect(checks[0]?.durationMs).toBe(2000);
    expect(checks[1]?.durationMs).toBeNull();
  });

  it("lists blobs and rejects a truncated tree", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json({
          tree: [
            { path: "docs/a.md", type: "blob" },
            { path: "docs", type: "tree" },
          ],
          truncated: false,
        }),
      ),
    );
    const provider = new GitHubProvider("https://github.com", "token");
    await expect(provider.listFiles("a/b", "docs/update")).resolves.toEqual(["docs/a.md"]);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ tree: [], truncated: true })),
    );
    await expect(provider.listFiles("a/b", "main")).rejects.toThrow("too large");
  });

  it("decodes base64 files and rejects unsupported encodings", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ content: "0J/RgNC40LLQtdGC\n", encoding: "base64" })),
    );
    const provider = new GitHubProvider("https://github.com", "token");
    await expect(provider.readFile("a/b", "main", "docs/a b.md")).resolves.toBe("Привет");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => json({ content: "text", encoding: "utf-8" })),
    );
    await expect(provider.readFile("a/b", "main", "a.md")).rejects.toThrow(
      "Unsupported GitHub file encoding",
    );
  });

  it("creates delete entries without blobs and reports a concurrent ref update", async () => {
    const responses = [
      json({ object: { sha: "head" } }),
      json({ tree: { sha: "base" } }),
      json({ sha: "tree" }, 201),
      json({ html_url: "commit-url", sha: "commit" }, 201),
      new Response("changed", { status: 422 }),
    ];
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calls.push([input, init]);
        return responses.shift() ?? json({});
      }),
    );
    await expect(
      new GitHubProvider("https://github.com", "token").commitFiles({
        branch: "docs/a b",
        changes: [{ content: null, operation: "delete", path: "old.md" }],
        expectedHeadSha: "head",
        message: "Delete old page",
        repositoryId: "a/b",
      }),
    ).rejects.toBeInstanceOf(ProviderConflictError);
    expect(JSON.parse(String(calls[2]?.[1]?.body)).tree).toEqual([
      { mode: "100644", path: "old.md", sha: null, type: "blob" },
    ]);
    expect(String(calls[0]?.[0])).toContain("docs/a%20b");
  });

  it("includes provider response details in API errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("forbidden", { status: 403 })),
    );
    await expect(
      new GitHubProvider("https://github.com", "token").getRepository("a/b"),
    ).rejects.toThrow("Provider request failed with 403: forbidden");
  });
});

describe("repository locator normalization", () => {
  it.each([
    ["gitlab", " /group/nested/docs.git/ ", "group/nested/docs"],
    ["github", "acme/docs.git", "acme/docs"],
    ["github", "https://github.com/acme/docs/tree/main", "acme/docs"],
  ] as const)("normalizes %s locator %s", (kind, input, expected) => {
    expect(normalizeRepositoryLocator(kind, input)).toBe(expected);
  });
});

it("compares GitLab changes from the merge base and handles renames", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    json({
      diffs: [
        { old_path: "a.md", new_path: "a.md", new_file: true },
        { old_path: "old.md", new_path: "new.md", renamed_file: true },
        { old_path: "gone.md", new_path: "gone.md", deleted_file: true },
        { old_path: "edit.md", new_path: "edit.md" },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  expect(
    await new GitLabProvider("https://gitlab.test", "token").compareFiles("9", "stable", "sha"),
  ).toEqual([
    { path: "a.md", status: "add" },
    { path: "old.md", status: "delete" },
    { path: "new.md", status: "add" },
    { path: "gone.md", status: "delete" },
    { path: "edit.md", status: "modify" },
  ]);
  const url = new URL(String(fetchMock.mock.calls[0]?.[0]));
  expect(url.searchParams.get("straight")).toBe("false");
  expect(url.searchParams.get("from")).toBe("stable");
  fetchMock.mockResolvedValue(json({ compare_timeout: true, diffs: [] }));
  await expect(
    new GitLabProvider("https://gitlab.test", "token").compareFiles("9", "stable", "sha"),
  ).rejects.toThrow("полный список");
});
it("maps GitHub comparison statuses and rejects potentially truncated file lists", async () => {
  const fetchMock = vi.fn().mockResolvedValue(
    json({
      files: [
        { filename: "new.md", previous_filename: "old.md", status: "renamed" },
        { filename: "logo.png", status: "modified" },
      ],
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const provider = new GitHubProvider("https://github.com", "token");
  expect(await provider.compareFiles("org/repo", "main", "sha")).toEqual([
    { path: "old.md", status: "delete" },
    { path: "new.md", status: "add" },
    { path: "logo.png", status: "modify" },
  ]);
  fetchMock.mockResolvedValue(
    json({ files: Array.from({ length: 300 }, () => ({ filename: "a", status: "added" })) }),
  );
  await expect(provider.compareFiles("org/repo", "main", "sha")).rejects.toThrow("ограничил");
});

it.each(["gitlab", "github"] as const)(
  "loads all %s review states beyond the first page while default lookups remain open-only",
  async (kind) => {
    const row =
      kind === "gitlab"
        ? {
            iid: 1,
            sha: "sha",
            source_branch: "work",
            target_branch: "main",
            state: "merged",
            title: "Done",
            web_url: "https://git.test/1",
          }
        : {
            number: 1,
            head: { ref: "work", sha: "sha" },
            base: { ref: "main" },
            state: "closed",
            merged_at: "2026-09-11",
            title: "Done",
            html_url: "https://git.test/1",
          };
    const request = vi
      .fn()
      .mockResolvedValueOnce(json(Array.from({ length: 100 }, () => row)))
      .mockResolvedValueOnce(json([row]))
      .mockResolvedValueOnce(json([]));
    vi.stubGlobal("fetch", request);
    const provider =
      kind === "gitlab"
        ? new GitLabProvider("https://gitlab.test", "token")
        : new GitHubProvider("https://github.com", "token");
    const reviews = await provider.listChangeRequests("team/docs", "all");
    expect(reviews).toHaveLength(101);
    expect(reviews.every((review) => review.state === "merged")).toBe(true);
    expect(String(request.mock.calls[1]?.[0])).toContain("page=2");
    expect(String(request.mock.calls[0]?.[0])).toContain("state=all");
    await provider.listChangeRequests("team/docs");
    expect(String(request.mock.calls[2]?.[0])).toContain(
      kind === "gitlab" ? "state=opened" : "state=open",
    );
  },
);
