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
