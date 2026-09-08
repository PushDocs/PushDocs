import type { GitProvider } from "@pushdocs/providers";
import { describe, expect, it, vi } from "vitest";
import type { GitTransport } from "./git-transport";
import {
  booleanFromPayload,
  createWorkerService as createService,
  loadTextOrNull,
  projectIdFromPayload,
  repositoryPath,
  stringFromPayload,
  type WorkerRepository,
  type WorkerServiceOptions,
} from "./service";

function createWorkerService(options: WorkerServiceOptions) {
  const service = createService({
    ...options,
    createGitTransport: () => {
      let preparedInput: Parameters<GitTransport["prepare"]>[0];
      return {
        prepare: async (input) => {
          preparedInput = input;
          return { branch: input.branch, parentSha: input.baseSha, sha: "commit-sha" };
        },
        publish: async () => {
          const client = options.createProvider?.({
            baseUrl: "https://gitlab.test",
            kind: "gitlab",
            token: "token",
          });
          if (!client) throw new Error("Missing Git fixture");
          const result = await client.commitFiles({
            branch: preparedInput.branch,
            changes: preparedInput.changes,
            expectedHeadSha: preparedInput.baseSha,
            message: preparedInput.message,
            repositoryId: "42",
          });
          return { sha: result.sha, alreadyApplied: false };
        },
      };
    },
  });
  return {
    ...service,
    submitChangeSet: (payload: unknown) =>
      service.submitChangeSet({
        userId: "actor",
        operationId: "attempt",
        createdAt: "2026-09-08T00:00:00Z",
        ...(payload as Record<string, unknown>),
      }),
  };
}

function provider(): GitProvider {
  return {
    commitFiles: vi.fn().mockResolvedValue({ sha: "commit-sha", url: "commit-url" }),
    ensureChangeRequest: vi.fn().mockResolvedValue({ id: "review" }),
    getRepository: vi.fn(),
    kind: "gitlab",
    listBranches: vi.fn().mockResolvedValue([{ name: "main", sha: "head" }]),
    listChangeRequests: vi.fn().mockResolvedValue([]),
    listChecks: vi.fn().mockResolvedValue([]),
    listFiles: vi.fn().mockResolvedValue([]),
    readFile: vi.fn().mockResolvedValue("# Document"),
    readBinary: vi.fn().mockResolvedValue(Buffer.from("original image")),
  } as unknown as GitProvider;
}

function repository(): WorkerRepository {
  return {
    claimNextJob: vi.fn().mockResolvedValue(undefined),
    heartbeatJob: vi.fn().mockResolvedValue(true),
    completeJob: vi.fn(),
    ensureBranches: vi.fn(),
    ensureProjectComponents: vi.fn(),
    failJob: vi.fn(),
    getChangeSetSubmission: vi.fn(),
    getProjectSyncTarget: vi.fn().mockResolvedValue(syncTarget),
    requireProjectAccess: vi.fn().mockResolvedValue({ role: "editor" }),
    savePreparedCommit: vi.fn(),
    discardRejectedCommit: vi.fn(),
    withGitRefLock: vi.fn(async (_key, operation) => operation()),
    listActiveProjectIds: vi.fn().mockResolvedValue([]),
    markChangeSetConflicted: vi.fn(),
    markChangeSetSubmitted: vi.fn(),
    markProjectAttention: vi.fn(),
    releaseChangeSetSubmission: vi.fn(),
    replaceChangeRequests: vi.fn(),
    replaceImportedDocuments: vi.fn(),
  } as unknown as WorkerRepository;
}

const syncTarget = {
  base_url: "https://gitlab.test",
  default_branch: "main",
  kind: "gitlab" as const,
  project_id: "project",
  provider_repository_id: "42",
  root_path: ".",
  secret_encrypted: "encrypted",
};

const submissionTarget = {
  ...syncTarget,
  clone_url: "https://gitlab.test/demo/docs.git",
  prepared_commit: null,
  attachments: [] as Array<{ repository_path: string; storage_key: string }>,
  base_commit_sha: "base",
  branch: "docs/update",
  branch_context_id: "branch-context",
  change_set_id: "change",
  files: [
    {
      base_content: "# Base",
      operation: "modify" as const,
      ours_content: "# Ours",
      path: "docs/a.md",
    },
  ],
  status: "submitting" as const,
};

describe("worker payloads and paths", () => {
  it("reads typed values from a job payload", () => {
    const payload = { branch: "docs/update", createReview: true, projectId: "project" };
    expect(projectIdFromPayload(payload)).toBe("project");
    expect(stringFromPayload(payload, "branch")).toBe("docs/update");
    expect(booleanFromPayload(payload, "createReview")).toBe(true);
    expect(booleanFromPayload(payload, "missing")).toBe(false);
    expect(booleanFromPayload(null, "missing")).toBe(false);
  });

  it.each([null, undefined, {}, { projectId: 3 }])("rejects project id payload %j", (payload) => {
    expect(() => projectIdFromPayload(payload)).toThrow("does not contain projectId");
  });

  it.each([null, undefined, {}, { branch: 3 }])("rejects string payload %j", (payload) => {
    expect(() => stringFromPayload(payload, "branch")).toThrow("does not contain branch");
  });

  it("joins project roots and repository paths", () => {
    expect(repositoryPath(".", "docs/a.md")).toBe("docs/a.md");
    expect(repositoryPath("/products/one/", "docs/a.md")).toBe("products/one/docs/a.md");
  });

  it("returns null only for a provider 404", async () => {
    const client = provider();
    vi.mocked(client.readFile).mockRejectedValueOnce(new Error("Provider request failed with 404"));
    await expect(loadTextOrNull(client, "42", "head", "missing.md")).resolves.toBeNull();
    vi.mocked(client.readFile).mockRejectedValueOnce(new Error("Provider request failed with 500"));
    await expect(loadTextOrNull(client, "42", "head", "broken.md")).rejects.toThrow("500");
  });
});

describe("branch and review synchronization", () => {
  it("imports Docusaurus documents and detected components", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "main", sha: "head" }]);
    vi.mocked(client.listFiles).mockResolvedValue([
      "docs/intro.md",
      "docs/component.mdx",
      "static/img/a.png",
    ]);
    vi.mocked(client.readFile)
      .mockResolvedValueOnce("# Intro")
      .mockResolvedValueOnce("# Component\n\n<Callout />");
    const worker = createWorkerService({ repository: port });

    await worker.synchronizeBranch("project", "main", client);

    expect(port.replaceImportedDocuments).toHaveBeenCalledWith(
      "project",
      "main",
      "head",
      expect.arrayContaining([
        expect.objectContaining({ path: "docs/intro.md", title: "Intro" }),
        expect.objectContaining({ path: "docs/component.mdx", title: "Component" }),
      ]),
      ["docs/intro.md", "docs/component.mdx", "static/img/a.png"],
    );
    expect(port.ensureProjectComponents).toHaveBeenCalledWith("project", ["Callout"]);
    expect(client.readFile).toHaveBeenCalledTimes(2);
  });

  it("loads large branches in bounded batches", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    vi.mocked(client.listFiles).mockResolvedValue(
      Array.from({ length: 13 }, (_, index) => `docs/${index}.md`),
    );
    await createWorkerService({ repository: port }).synchronizeBranch("project", "main", client);
    expect(client.readFile).toHaveBeenCalledTimes(13);
    expect(port.replaceImportedDocuments).toHaveBeenCalledWith(
      "project",
      "main",
      "head",
      expect.any(Array),
      Array.from({ length: 13 }, (_, index) => `docs/${index}.md`),
    );
  });

  it("rejects unavailable projects and missing branches", async () => {
    const port = repository();
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(undefined);
    const worker = createWorkerService({ repository: port });
    await expect(worker.synchronizeBranch("project", "main")).rejects.toThrow(
      "Project sync target is unavailable",
    );
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    const client = provider();
    vi.mocked(client.listBranches).mockResolvedValue([]);
    await expect(worker.synchronizeBranch("project", "main", client)).rejects.toThrow(
      "Branch main was not found",
    );
  });

  it("synchronizes all branches, the default branch, reviews, and checks", async () => {
    const port = repository();
    const client = provider();
    const request = {
      headSha: "review-head",
      id: "7",
      sourceBranch: "docs",
      state: "open" as const,
      targetBranch: "main",
      title: "Docs",
      url: "review-url",
    };
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "main", sha: "head" }]);
    vi.mocked(client.listChangeRequests).mockResolvedValue([request]);
    vi.mocked(client.listChecks).mockResolvedValue([
      {
        conclusion: "success",
        durationMs: 10,
        id: "check",
        name: "test",
        required: true,
        url: null,
      },
    ]);
    const factory = vi.fn(() => client);
    const worker = createWorkerService({
      createProvider: factory,
      decryptSecret: () => "token",
      repository: port,
    });

    await worker.synchronizeProject("project");

    expect(factory).toHaveBeenCalledWith({
      baseUrl: "https://gitlab.test",
      kind: "gitlab",
      token: "token",
    });
    expect(port.ensureBranches).toHaveBeenCalledWith("project", [{ name: "main", sha: "head" }]);
    expect(port.replaceChangeRequests).toHaveBeenCalledWith("project", [
      {
        checks: [expect.objectContaining({ id: "check" })],
        externalId: "7",
        headSha: "review-head",
        sourceBranch: "docs",
        state: "open",
        targetBranch: "main",
        title: "Docs",
        url: "review-url",
      },
    ]);
  });
});

describe("change set submission", () => {
  it("never forwards a provider credential to a different clone origin", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      clone_url: "https://unrelated.invalid/docs.git",
    } as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    await expect(
      createWorkerService({
        repository: port,
        createProvider: () => client,
        decryptSecret: () => "fixture",
      }).submitChangeSet({ changeSetId: "change", projectId: "project", message: "Edit" }),
    ).rejects.toThrow("origin");
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("uses the native Git transport and rejects an invalid provider SHA before writing", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    await expect(
      createService({
        repository: port,
        createProvider: () => client,
        decryptSecret: () => "fixture",
      }).submitChangeSet({
        changeSetId: "change",
        projectId: "project",
        userId: "actor",
        operationId: "native",
        createdAt: "2026-09-08T00:00:00Z",
        message: "Edit",
        createReview: false,
      }),
    ).rejects.toThrow("Invalid Git object id");
  });
  it("stops when project access is revoked before publishing", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    vi.mocked(port.getProjectSyncTarget)
      .mockResolvedValueOnce(syncTarget as never)
      .mockResolvedValueOnce(undefined);
    await expect(
      createWorkerService({
        repository: port,
        createProvider: () => client,
        decryptSecret: () => "fixture",
      }).submitChangeSet({
        changeSetId: "change",
        projectId: "project",
        message: "Edit",
        createReview: false,
      }),
    ).rejects.toThrow("revoked");
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("recognizes an already completed submission", async () => {
    const port = repository();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      status: "submitted",
    } as never);
    await createWorkerService({ repository: port }).submitChangeSet({
      changeSetId: "change",
      projectId: "project",
      message: "Edit",
    });
    expect(port.savePreparedCommit).not.toHaveBeenCalled();
    vi.mocked(port.getProjectSyncTarget).mockResolvedValueOnce(undefined);
    await expect(
      createWorkerService({ repository: port }).submitChangeSet({
        changeSetId: "change",
        projectId: "project",
        message: "Edit",
      }),
    ).rejects.toThrow("no longer granted");
  });
  it("rebases independent text operations onto an advanced head without rewriting identical files", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [
        { path: "docs/edit.md", ours_content: "# Ours", operation: "modify" },
        { path: "docs/new.md", ours_content: "# New", operation: "add" },
        { path: "docs/delete.md", ours_content: null, operation: "delete" },
        { path: "docs/same.md", ours_content: "# Same", operation: "modify" },
      ],
    } as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readFile).mockImplementation(async (_repo, _ref, file) => {
      if (file === "docs/new.md") throw new Error("404");
      return file === "docs/same.md" ? "# Same" : "# Base";
    });
    await createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "fixture",
    }).submitChangeSet({ changeSetId: "change", projectId: "project", message: "Edit" });
    expect(client.commitFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: [
          expect.objectContaining({ path: "docs/edit.md", operation: "update" }),
          expect.objectContaining({ path: "docs/new.md", operation: "create" }),
          expect.objectContaining({ path: "docs/delete.md", operation: "delete" }),
        ],
      }),
    );
  });
  it("treats missing binary files as deletions but propagates provider failures", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [{ path: "static/gone.png", operation: "delete", ours_content: null }],
      attachments: [],
    } as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readBinary).mockRejectedValue(new Error("404"));
    const worker = createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "fixture",
    });
    const input = {
      changeSetId: "change",
      projectId: "project",
      message: "Delete",
      createReview: false,
    };
    await worker.submitChangeSet(input);
    expect(client.commitFiles).toHaveBeenCalledWith(expect.objectContaining({ changes: [] }));
    vi.mocked(client.readBinary).mockRejectedValueOnce(new Error("403"));
    await expect(worker.submitChangeSet(input)).rejects.toThrow("403");
  });
  it("compares original bytes before deleting a binary file", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [{ path: "static/image.png", operation: "delete", ours_content: null }],
      attachments: [],
    } as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readBinary).mockImplementation(async (_repo, ref) =>
      Buffer.from(ref === "base" ? [255] : [254]),
    );
    await createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "token",
    }).submitChangeSet({
      changeSetId: "change",
      projectId: "project",
      message: "Delete",
      createReview: false,
    });
    expect(port.markChangeSetConflicted).toHaveBeenCalledWith("change", "project", "upstream", [
      expect.objectContaining({ kind: "binary", oursContent: null }),
    ]);
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("does not overwrite a binary file changed by another author", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [],
      attachments: [{ repository_path: "static/image.png", storage_key: "image" }],
    } as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readBinary).mockImplementation(async (_repo, ref) =>
      Buffer.from(ref === "base" ? "original" : "theirs"),
    );
    const worker = createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "token",
      readAttachment: async () => Buffer.from("ours"),
    });
    await worker.submitChangeSet({
      changeSetId: "change",
      projectId: "project",
      message: "Image",
      createReview: false,
    });
    expect(port.markChangeSetConflicted).toHaveBeenCalledWith("change", "project", "upstream", [
      expect.objectContaining({ kind: "binary", path: "static/image.png" }),
    ]);
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("bounds the total binary submission before preparing or publishing a commit", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [],
      attachments: Array.from({ length: 5 }, (_, index) => ({
        repository_path: `static/${index}.png`,
        storage_key: String(index),
      })),
    } as never);
    const bytes = new Uint8Array(64 * 1024 * 1024);
    const worker = createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "fixture",
      readAttachment: async () => bytes,
    });
    await expect(
      worker.submitChangeSet({
        changeSetId: "change",
        projectId: "project",
        message: "Media",
        createReview: false,
      }),
    ).rejects.toThrow("256 MiB");
    expect(port.savePreparedCommit).not.toHaveBeenCalled();
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("rejects an oversized attachment and an oversized text change set without a Git write", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      files: [],
      attachments: [{ repository_path: "static/a.png", storage_key: "a" }],
    } as never);
    const worker = createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "fixture",
      readAttachment: async () => new Uint8Array(64 * 1024 * 1024 + 1),
    });
    const payload = {
      changeSetId: "change",
      projectId: "project",
      message: "Media",
      createReview: false,
    };
    await expect(worker.submitChangeSet(payload)).rejects.toThrow("64 MiB");
    const text = "x".repeat(5_000_000);
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue({
      ...submissionTarget,
      attachments: [],
      files: Array.from({ length: 54 }, (_, index) => ({
        path: `docs/${index}.md`,
        operation: "add",
        ours_content: text,
      })),
    } as never);
    await expect(worker.submitChangeSet(payload)).rejects.toThrow("256 MiB");
    expect(client.commitFiles).not.toHaveBeenCalled();
  });
  it("imports configured technical files at the immutable SHA", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    vi.mocked(client.listFiles).mockResolvedValue([
      ".pushdocs/config.json",
      "sidebars.js",
      "docs/_category_.json",
    ]);
    vi.mocked(client.readFile).mockImplementation(async (_repo, ref, file) => {
      expect(ref).toBe("head");
      return file === ".pushdocs/config.json"
        ? '{"version":1}'
        : file.endsWith(".json")
          ? '{"label":"Guides"}'
          : "module.exports = {}";
    });
    await createWorkerService({ repository: port }).synchronizeBranch("project", "main", client);
    expect(port.replaceImportedDocuments).toHaveBeenCalledWith(
      "project",
      "main",
      "head",
      expect.arrayContaining([
        expect.objectContaining({
          path: "sidebars.js",
          contentHash: expect.stringMatching(/^[a-f0-9]{64}$/),
        }),
      ]),
      expect.any(Array),
    );
  });
  it("stops and records conflicts when upstream content diverged", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readFile).mockImplementation(async (_repository, ref) =>
      ref === "base" ? "# Base" : "# Theirs",
    );
    const worker = createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      repository: port,
    });

    await worker.submitChangeSet({
      changeSetId: "change",
      createReview: true,
      message: "Update docs",
      projectId: "project",
    });

    expect(port.markChangeSetConflicted).toHaveBeenCalledWith("change", "project", "upstream", [
      {
        baseContent: "# Base",
        oursContent: "# Ours",
        path: "docs/a.md",
        theirsContent: "# Theirs",
      },
    ]);
    expect(client.commitFiles).not.toHaveBeenCalled();
  });

  it("commits documents and attachments and creates a review", async () => {
    const port = repository();
    const client = provider();
    const target = {
      ...submissionTarget,
      attachments: [
        { repository_path: "static/img/existing.png", storage_key: "existing" },
        { repository_path: "static/img/new.png", storage_key: "new" },
      ],
      files: [
        { base_content: null, operation: "add", ours_content: "new", path: "docs/new.md" },
        { base_content: "old", operation: "modify", ours_content: "updated", path: "docs/a.md" },
        { base_content: "remove", operation: "delete", ours_content: null, path: "docs/old.md" },
      ],
      root_path: "site",
    };
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(target as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    vi.mocked(client.listFiles).mockResolvedValue(["site/static/img/existing.png"]);
    vi.mocked(client.listChangeRequests).mockResolvedValue([]);
    const readAttachment = vi.fn(async (filePath: string) => Buffer.from(filePath));
    const worker = createWorkerService({
      attachmentsRoot: "/attachments",
      createProvider: () => client,
      decryptSecret: () => "token",
      readAttachment,
      repository: port,
    });

    await worker.submitChangeSet({
      changeSetId: "change",
      createReview: true,
      message: "Update docs\nDetails",
      projectId: "project",
    });

    expect(client.commitFiles).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "docs/update",
        changes: [
          expect.objectContaining({ operation: "create", path: "site/docs/new.md" }),
          expect.objectContaining({ operation: "update", path: "site/docs/a.md" }),
          expect.objectContaining({ content: null, operation: "delete", path: "site/docs/old.md" }),
          expect.objectContaining({ operation: "update", path: "site/static/img/existing.png" }),
          expect.objectContaining({ operation: "create", path: "site/static/img/new.png" }),
        ],
        expectedHeadSha: "base",
      }),
    );
    expect(readAttachment).toHaveBeenCalledWith("/attachments/existing");
    expect(client.ensureChangeRequest).toHaveBeenCalledWith({
      repositoryId: "42",
      sourceBranch: "docs/update",
      targetBranch: "main",
      title: "Update docs",
    });
    expect(port.markChangeSetSubmitted).toHaveBeenCalledWith({
      changeSetId: "change",
      commitSha: "commit-sha",
      commitUrl: "https://gitlab.test/demo/docs/-/commit/commit-sha",
      projectId: "project",
    });
    expect(port.replaceChangeRequests).toHaveBeenCalled();
  });

  it("does not create a review on the default branch", async () => {
    const port = repository();
    const client = provider();
    const target = { ...submissionTarget, branch: "main", default_branch: "main" };
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(target as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "main", sha: "base" }]);
    await createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      repository: port,
    }).submitChangeSet({
      changeSetId: "change",
      createReview: true,
      message: "Update",
      projectId: "project",
    });
    expect(client.ensureChangeRequest).not.toHaveBeenCalled();
  });

  it("continues when changed upstream content equals the draft", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "new-head" }]);
    vi.mocked(client.readFile).mockResolvedValue("# Ours");
    await createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      repository: port,
    }).submitChangeSet({
      changeSetId: "change",
      createReview: false,
      message: "Update",
      projectId: "project",
    });
    expect(port.markChangeSetConflicted).not.toHaveBeenCalled();
    expect(client.commitFiles).toHaveBeenCalledWith(
      expect.objectContaining({ expectedHeadSha: "new-head" }),
    );
  });

  it.each([
    [undefined, "Change set is unavailable"],
    [{ ...submissionTarget, project_id: "other" }, "Change set is unavailable"],
    [{ ...submissionTarget, status: "open" }, "Change set is not ready"],
  ])("rejects an invalid submission target", async (target, message) => {
    const port = repository();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(target as never);
    await expect(
      createWorkerService({ repository: port }).submitChangeSet({
        changeSetId: "change",
        message: "Update",
        projectId: "project",
      }),
    ).rejects.toThrow(message);
  });

  it("rejects a submission whose branch disappeared", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([]);
    await expect(
      createWorkerService({
        createProvider: () => client,
        decryptSecret: () => "token",
        repository: port,
      }).submitChangeSet({
        changeSetId: "change",
        message: "Update",
        projectId: "project",
      }),
    ).rejects.toThrow("Branch docs/update was not found");
  });
});

describe("job execution and review polling", () => {
  it("does not process a job after losing its lease", async () => {
    const port = repository();
    vi.mocked(port.claimNextJob).mockResolvedValue({ id: "job", attempts: 2 } as never);
    vi.mocked(port.heartbeatJob).mockResolvedValue(false);
    await expect(createWorkerService({ repository: port }).runJob()).resolves.toBe(true);
    expect(port.completeJob).not.toHaveBeenCalled();
  });
  it("releases a definitively rejected write instead of retrying the stale parent", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.claimNextJob).mockResolvedValue({
      id: "job",
      kind: "change-set.submit",
      attempts: 1,
      payload: {
        changeSetId: "change",
        projectId: "project",
        userId: "actor",
        operationId: "attempt",
        createdAt: "2026-09-08T00:00:00Z",
        message: "Edit",
      },
    } as never);
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "base" }]);
    vi.mocked(client.commitFiles).mockRejectedValue(
      Object.assign(new Error("Ref changed"), { code: "PROVIDER_CONFLICT" }),
    );
    await createWorkerService({
      repository: port,
      createProvider: () => client,
      decryptSecret: () => "fixture",
    }).runJob();
    expect(port.discardRejectedCommit).toHaveBeenCalledWith("change", "project");
    expect(port.failJob).toHaveBeenCalledWith("job", "Ref changed", false, 1);
  });
  it("renews slow jobs and reports a failed heartbeat", async () => {
    vi.useFakeTimers();
    try {
      const port = repository();
      const client = provider();
      const logger = { error: vi.fn() };
      vi.mocked(port.claimNextJob).mockResolvedValue({
        id: "job",
        kind: "branch.sync",
        attempts: 1,
        payload: { projectId: "project", branch: "main" },
      } as never);
      let finish: (value: Array<{ name: string; sha: string }>) => void = () => undefined;
      vi.mocked(client.listBranches).mockReturnValue(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      const task = createWorkerService({
        repository: port,
        createProvider: () => client,
        decryptSecret: () => "fixture",
        logger,
      }).runJob();
      await vi.advanceTimersByTimeAsync(1);
      vi.mocked(port.heartbeatJob).mockRejectedValueOnce(new Error("database offline"));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("heartbeat failed"));
      finish([{ name: "main", sha: "head" }]);
      await task;
    } finally {
      vi.useRealTimers();
    }
  });
  it("reports an empty queue", async () => {
    await expect(createWorkerService({ repository: repository() }).runJob()).resolves.toBe(false);
  });

  it("completes a branch synchronization job", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.claimNextJob).mockResolvedValue({
      attempts: 1,
      id: "job",
      kind: "branch.sync",
      payload: { branch: "main", projectId: "project" },
    } as never);
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    await createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      repository: port,
    }).runJob();
    expect(port.completeJob).toHaveBeenCalledWith("job", 1);
  });

  it("completes a project synchronization job", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.claimNextJob).mockResolvedValue({
      attempts: 1,
      id: "job",
      kind: "project.sync",
      payload: { projectId: "project" },
    } as never);
    vi.mocked(port.getProjectSyncTarget).mockResolvedValue(syncTarget as never);
    await createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      repository: port,
    }).runJob();
    expect(port.ensureBranches).toHaveBeenCalled();
    expect(port.completeJob).toHaveBeenCalledWith("job", 1);
  });

  it("retries failed jobs and logs the failure", async () => {
    const port = repository();
    const logger = { error: vi.fn() };
    vi.mocked(port.claimNextJob).mockResolvedValue({
      attempts: 1,
      id: "job",
      kind: "unsupported",
      payload: { projectId: "project" },
    } as never);
    await expect(createWorkerService({ logger, repository: port }).runJob()).resolves.toBe(true);
    expect(port.failJob).toHaveBeenCalledWith("job", "Unsupported job kind: unsupported", true, 1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('"jobId":"job"'));
  });

  it("releases a submission after its fifth failed attempt", async () => {
    const port = repository();
    vi.mocked(port.claimNextJob).mockResolvedValue({
      attempts: 5,
      id: "job",
      kind: "change-set.submit",
      payload: { changeSetId: "change", message: "Update", projectId: "project" },
    } as never);
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(undefined);
    await createWorkerService({ logger: { error: vi.fn() }, repository: port }).runJob();
    expect(port.markProjectAttention).toHaveBeenCalledWith("project");
    expect(port.releaseChangeSetSubmission).toHaveBeenCalledWith(
      "change",
      "project",
      "Change set is unavailable",
    );
    expect(port.failJob).toHaveBeenCalledWith("job", "Change set is unavailable", false, 5);
  });

  it("polls visible projects and isolates provider failures", async () => {
    const port = repository();
    const client = provider();
    const logger = { error: vi.fn() };
    vi.mocked(port.listActiveProjectIds).mockResolvedValue(["one", "missing", "broken"]);
    vi.mocked(port.getProjectSyncTarget)
      .mockResolvedValueOnce(syncTarget as never)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("database unavailable"));
    await createWorkerService({
      createProvider: () => client,
      decryptSecret: () => "token",
      logger,
      repository: port,
    }).synchronizeActiveReviews();
    expect(port.replaceChangeRequests).toHaveBeenCalledWith("one", []);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("database unavailable"));
  });
});
