import type { CheckRunSummary, ProviderKind } from "@pushdocs/contracts";

export interface ProviderRepository {
  cloneUrl: string;
  defaultBranch: string;
  fullName: string;
  id: string;
  webUrl: string;
}

export interface ProviderBranch {
  name: string;
  sha: string;
}

export interface ProviderChangeRequest {
  headSha: string;
  id: string;
  sourceBranch: string;
  state: "open" | "merged" | "closed";
  targetBranch: string;
  title: string;
  url: string;
}

export interface ProviderFileChange {
  content: Uint8Array | null;
  operation: "create" | "update" | "delete";
  path: string;
}

export class ProviderConflictError extends Error {
  readonly code = "PROVIDER_CONFLICT";
}

export interface GitProvider {
  readonly kind: ProviderKind;
  commitFiles(input: {
    branch: string;
    changes: ProviderFileChange[];
    expectedHeadSha: string;
    message: string;
    repositoryId: string;
  }): Promise<{ sha: string; url: string }>;
  ensureChangeRequest(input: {
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
  }): Promise<ProviderChangeRequest>;
  getRepository(repositoryId: string): Promise<ProviderRepository>;
  listBranches(repositoryId: string): Promise<ProviderBranch[]>;
  listChangeRequests(repositoryId: string): Promise<ProviderChangeRequest[]>;
  listChecks(repositoryId: string, sha: string): Promise<CheckRunSummary[]>;
  listFiles(repositoryId: string, ref: string): Promise<string[]>;
  readFile(repositoryId: string, ref: string, path: string): Promise<string>;
}

async function readJson<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Provider request failed with ${response.status}: ${detail.slice(0, 500)}`);
  }
  return response.json() as Promise<T>;
}

export class GitLabProvider implements GitProvider {
  readonly kind = "gitlab" as const;
  private readonly apiUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.apiUrl = new URL("/api/v4/", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(new URL(path, this.apiUrl), {
      ...init,
      headers: {
        "PRIVATE-TOKEN": this.token,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async commitFiles(input: {
    branch: string;
    changes: ProviderFileChange[];
    expectedHeadSha: string;
    message: string;
    repositoryId: string;
  }): Promise<{ sha: string; url: string }> {
    const branches = await this.listBranches(input.repositoryId);
    const current = branches.find((branch) => branch.name === input.branch);
    if (!current || current.sha !== input.expectedHeadSha) {
      throw new ProviderConflictError("GitLab branch changed before the commit was created");
    }
    const actions = await Promise.all(
      input.changes.map(async (change) => {
        const lastCommitId =
          change.operation === "create"
            ? undefined
            : (
                await readJson<{ last_commit_id: string }>(
                  await this.request(
                    `projects/${encodeURIComponent(input.repositoryId)}/repository/files/${encodeURIComponent(change.path)}?ref=${encodeURIComponent(input.expectedHeadSha)}`,
                  ),
                )
              ).last_commit_id;
        return {
          action: change.operation,
          content: change.content ? Buffer.from(change.content).toString("base64") : undefined,
          encoding: change.content ? "base64" : undefined,
          file_path: change.path,
          last_commit_id: lastCommitId,
        };
      }),
    );
    const response = await this.request(
      `projects/${encodeURIComponent(input.repositoryId)}/repository/commits`,
      {
        body: JSON.stringify({
          actions,
          branch: input.branch,
          commit_message: input.message,
        }),
        method: "POST",
      },
    );
    if (response.status === 400 || response.status === 409) {
      throw new ProviderConflictError(`GitLab rejected the commit: ${await response.text()}`);
    }
    const commit = await readJson<{ id: string; web_url: string }>(response);
    return { sha: commit.id, url: commit.web_url };
  }

  async ensureChangeRequest(input: {
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
  }): Promise<ProviderChangeRequest> {
    const existing = (await this.listChangeRequests(input.repositoryId)).find(
      (request) =>
        request.sourceBranch === input.sourceBranch && request.targetBranch === input.targetBranch,
    );
    if (existing) return existing;
    const row = await readJson<{
      iid: number;
      sha: string;
      source_branch: string;
      state: "opened" | "merged" | "closed";
      target_branch: string;
      title: string;
      web_url: string;
    }>(
      await this.request(`projects/${encodeURIComponent(input.repositoryId)}/merge_requests`, {
        body: JSON.stringify({
          source_branch: input.sourceBranch,
          target_branch: input.targetBranch,
          title: input.title,
        }),
        method: "POST",
      }),
    );
    return {
      headSha: row.sha,
      id: String(row.iid),
      sourceBranch: row.source_branch,
      state: row.state === "opened" ? "open" : row.state,
      targetBranch: row.target_branch,
      title: row.title,
      url: row.web_url,
    };
  }

  async getRepository(repositoryId: string): Promise<ProviderRepository> {
    const row = await readJson<{
      default_branch: string;
      http_url_to_repo: string;
      id: number;
      path_with_namespace: string;
      web_url: string;
    }>(await this.request(`projects/${encodeURIComponent(repositoryId)}`));
    return {
      cloneUrl: row.http_url_to_repo,
      defaultBranch: row.default_branch,
      fullName: row.path_with_namespace,
      id: String(row.id),
      webUrl: row.web_url,
    };
  }

  async listBranches(repositoryId: string): Promise<ProviderBranch[]> {
    const rows = await readJson<Array<{ commit: { id: string }; name: string }>>(
      await this.request(
        `projects/${encodeURIComponent(repositoryId)}/repository/branches?per_page=100`,
      ),
    );
    return rows.map((row) => ({ name: row.name, sha: row.commit.id }));
  }

  async listChangeRequests(repositoryId: string): Promise<ProviderChangeRequest[]> {
    const rows = await readJson<
      Array<{
        iid: number;
        merge_status: string;
        sha: string;
        source_branch: string;
        state: "opened" | "merged" | "closed";
        target_branch: string;
        title: string;
        web_url: string;
      }>
    >(
      await this.request(
        `projects/${encodeURIComponent(repositoryId)}/merge_requests?state=opened&per_page=100`,
      ),
    );
    return rows.map((row) => ({
      headSha: row.sha,
      id: String(row.iid),
      sourceBranch: row.source_branch,
      state: row.state === "opened" ? "open" : row.state,
      targetBranch: row.target_branch,
      title: row.title,
      url: row.web_url,
    }));
  }

  async listChecks(repositoryId: string, sha: string): Promise<CheckRunSummary[]> {
    const pipelines = await readJson<Array<{ id: number }>>(
      await this.request(
        `projects/${encodeURIComponent(repositoryId)}/pipelines?sha=${encodeURIComponent(sha)}&per_page=1`,
      ),
    );
    if (!pipelines[0]) return [];
    const rows = await readJson<
      Array<{
        allow_failure: boolean;
        duration: number | null;
        id: number;
        name: string;
        status: string;
        web_url: string;
      }>
    >(
      await this.request(
        `projects/${encodeURIComponent(repositoryId)}/pipelines/${pipelines[0].id}/jobs?per_page=100`,
      ),
    );
    return rows.map((row) => ({
      conclusion:
        row.status === "success"
          ? "success"
          : row.status === "failed"
            ? "failure"
            : row.status === "skipped"
              ? "skipped"
              : "running",
      durationMs: row.duration === null ? null : Math.round(row.duration * 1000),
      id: String(row.id),
      name: row.name,
      required: !row.allow_failure,
      url: row.web_url,
    }));
  }

  async listFiles(repositoryId: string, ref: string): Promise<string[]> {
    const files: string[] = [];
    for (let page = 1; ; page += 1) {
      const query = new URLSearchParams({
        page: String(page),
        per_page: "100",
        recursive: "true",
        ref,
      });
      const rows = await readJson<Array<{ path: string; type: string }>>(
        await this.request(
          `projects/${encodeURIComponent(repositoryId)}/repository/tree?${query.toString()}`,
        ),
      );
      files.push(...rows.filter((row) => row.type === "blob").map((row) => row.path));
      if (rows.length < 100) break;
    }
    return files;
  }

  async readFile(repositoryId: string, ref: string, filePath: string): Promise<string> {
    const query = new URLSearchParams({ ref });
    const response = await this.request(
      `projects/${encodeURIComponent(repositoryId)}/repository/files/${encodeURIComponent(filePath)}/raw?${query.toString()}`,
    );
    if (!response.ok) {
      throw new Error(`GitLab file request failed with ${response.status}`);
    }
    return response.text();
  }
}

export class GitHubProvider implements GitProvider {
  readonly kind = "github" as const;
  private readonly apiUrl: string;

  constructor(
    baseUrl: string,
    private readonly token: string,
  ) {
    this.apiUrl =
      new URL(baseUrl).hostname === "github.com"
        ? "https://api.github.com/"
        : new URL("/api/v3/", baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`).toString();
  }

  private request(path: string, init?: RequestInit): Promise<Response> {
    return fetch(new URL(path, this.apiUrl), {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(15_000),
    });
  }

  async commitFiles(input: {
    branch: string;
    changes: ProviderFileChange[];
    expectedHeadSha: string;
    message: string;
    repositoryId: string;
  }): Promise<{ sha: string; url: string }> {
    const refPath = input.branch.split("/").map(encodeURIComponent).join("/");
    const currentRef = await readJson<{ object: { sha: string } }>(
      await this.request(`repos/${input.repositoryId}/git/ref/heads/${refPath}`),
    );
    if (currentRef.object.sha !== input.expectedHeadSha) {
      throw new ProviderConflictError("GitHub branch changed before the commit was created");
    }
    const parent = await readJson<{ tree: { sha: string } }>(
      await this.request(`repos/${input.repositoryId}/git/commits/${input.expectedHeadSha}`),
    );
    const treeEntries = await Promise.all(
      input.changes.map(async (change) => {
        if (change.operation === "delete") {
          return { mode: "100644", path: change.path, sha: null, type: "blob" } as const;
        }
        const blob = await readJson<{ sha: string }>(
          await this.request(`repos/${input.repositoryId}/git/blobs`, {
            body: JSON.stringify({
              content: Buffer.from(change.content ?? []).toString("base64"),
              encoding: "base64",
            }),
            method: "POST",
          }),
        );
        return { mode: "100644", path: change.path, sha: blob.sha, type: "blob" } as const;
      }),
    );
    const tree = await readJson<{ sha: string }>(
      await this.request(`repos/${input.repositoryId}/git/trees`, {
        body: JSON.stringify({ base_tree: parent.tree.sha, tree: treeEntries }),
        method: "POST",
      }),
    );
    const commit = await readJson<{ html_url: string; sha: string }>(
      await this.request(`repos/${input.repositoryId}/git/commits`, {
        body: JSON.stringify({
          message: input.message,
          parents: [input.expectedHeadSha],
          tree: tree.sha,
        }),
        method: "POST",
      }),
    );
    const update = await this.request(`repos/${input.repositoryId}/git/refs/heads/${refPath}`, {
      body: JSON.stringify({ force: false, sha: commit.sha }),
      method: "PATCH",
    });
    if (update.status === 409 || update.status === 422) {
      throw new ProviderConflictError("GitHub branch advanced while the commit was prepared");
    }
    await readJson(update);
    return { sha: commit.sha, url: commit.html_url };
  }

  async ensureChangeRequest(input: {
    repositoryId: string;
    sourceBranch: string;
    targetBranch: string;
    title: string;
  }): Promise<ProviderChangeRequest> {
    const existing = (await this.listChangeRequests(input.repositoryId)).find(
      (request) =>
        request.sourceBranch === input.sourceBranch && request.targetBranch === input.targetBranch,
    );
    if (existing) return existing;
    const row = await readJson<{
      base: { ref: string };
      head: { ref: string; sha: string };
      html_url: string;
      number: number;
      state: "open" | "closed";
      title: string;
    }>(
      await this.request(`repos/${input.repositoryId}/pulls`, {
        body: JSON.stringify({
          base: input.targetBranch,
          head: input.sourceBranch,
          title: input.title,
        }),
        method: "POST",
      }),
    );
    return {
      headSha: row.head.sha,
      id: String(row.number),
      sourceBranch: row.head.ref,
      state: row.state,
      targetBranch: row.base.ref,
      title: row.title,
      url: row.html_url,
    };
  }

  async getRepository(repositoryId: string): Promise<ProviderRepository> {
    const row = await readJson<{
      clone_url: string;
      default_branch: string;
      full_name: string;
      html_url: string;
      id: number;
    }>(await this.request(`repos/${repositoryId}`));
    return {
      cloneUrl: row.clone_url,
      defaultBranch: row.default_branch,
      fullName: row.full_name,
      id: row.full_name,
      webUrl: row.html_url,
    };
  }

  async listBranches(repositoryId: string): Promise<ProviderBranch[]> {
    const rows = await readJson<Array<{ commit: { sha: string }; name: string }>>(
      await this.request(`repos/${repositoryId}/branches?per_page=100`),
    );
    return rows.map((row) => ({ name: row.name, sha: row.commit.sha }));
  }

  async listChangeRequests(repositoryId: string): Promise<ProviderChangeRequest[]> {
    const rows = await readJson<
      Array<{
        head: { ref: string; sha: string };
        html_url: string;
        merged_at: string | null;
        number: number;
        state: "open" | "closed";
        base: { ref: string };
        title: string;
      }>
    >(await this.request(`repos/${repositoryId}/pulls?state=open&per_page=100`));
    return rows.map((row) => ({
      headSha: row.head.sha,
      id: String(row.number),
      sourceBranch: row.head.ref,
      state: row.merged_at ? "merged" : row.state,
      targetBranch: row.base.ref,
      title: row.title,
      url: row.html_url,
    }));
  }

  async listChecks(repositoryId: string, sha: string): Promise<CheckRunSummary[]> {
    const payload = await readJson<{
      check_runs: Array<{
        completed_at: string | null;
        conclusion: string | null;
        details_url: string | null;
        id: number;
        name: string;
        started_at: string | null;
        status: string;
      }>;
    }>(await this.request(`repos/${repositoryId}/commits/${sha}/check-runs?per_page=100`));
    return payload.check_runs.map((row) => ({
      conclusion:
        row.status !== "completed"
          ? "running"
          : row.conclusion === "success"
            ? "success"
            : row.conclusion === "skipped"
              ? "skipped"
              : row.conclusion === "neutral"
                ? "neutral"
                : "failure",
      durationMs:
        row.started_at && row.completed_at
          ? new Date(row.completed_at).getTime() - new Date(row.started_at).getTime()
          : null,
      id: String(row.id),
      name: row.name,
      required: true,
      url: row.details_url,
    }));
  }

  async listFiles(repositoryId: string, ref: string): Promise<string[]> {
    const payload = await readJson<{
      tree: Array<{ path: string; type: string }>;
      truncated: boolean;
    }>(
      await this.request(`repos/${repositoryId}/git/trees/${encodeURIComponent(ref)}?recursive=1`),
    );
    if (payload.truncated) {
      throw new Error("The GitHub repository tree is too large for recursive import");
    }
    return payload.tree.filter((row) => row.type === "blob").map((row) => row.path);
  }

  async readFile(repositoryId: string, ref: string, filePath: string): Promise<string> {
    const response = await this.request(
      `repos/${repositoryId}/contents/${filePath
        .split("/")
        .map(encodeURIComponent)
        .join("/")}?ref=${encodeURIComponent(ref)}`,
    );
    const payload = await readJson<{ content: string; encoding: string }>(response);
    if (payload.encoding !== "base64") throw new Error("Unsupported GitHub file encoding");
    return Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  }
}

export function createProvider(input: {
  baseUrl: string;
  kind: ProviderKind;
  token: string;
}): GitProvider {
  return input.kind === "github"
    ? new GitHubProvider(input.baseUrl, input.token)
    : new GitLabProvider(input.baseUrl, input.token);
}

export function normalizeRepositoryLocator(kind: ProviderKind, value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    const path = decodeURIComponent(parsed.pathname)
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.git$/i, "");
    if (kind === "gitlab") return path.split("/-/", 1)[0] ?? path;
    return path.split("/").slice(0, 2).join("/");
  } catch {
    return trimmed.replace(/^\/+|\/+$/g, "").replace(/\.git$/i, "");
  }
}
