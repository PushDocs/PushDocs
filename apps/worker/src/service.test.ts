import type { GitProvider } from "@pushdocs/providers";
import { describe, expect, it, vi } from "vitest";
import {
  booleanFromPayload,
  createWorkerService,
  loadTextOrNull,
  projectIdFromPayload,
  repositoryPath,
  stringFromPayload,
  type WorkerRepository,
} from "./service";

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
  } as unknown as GitProvider;
}

function repository(): WorkerRepository {
  return {
    claimNextJob: vi.fn().mockResolvedValue(undefined),
    completeJob: vi.fn(),
    ensureBranches: vi.fn(),
    ensureProjectComponents: vi.fn(),
    failJob: vi.fn(),
    getChangeSetSubmission: vi.fn(),
    getProjectSyncTarget: vi.fn(),
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
    );
  });

  it("rejects unavailable projects and missing branches", async () => {
    const port = repository();
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
  it("stops and records conflicts when upstream content diverged", async () => {
    const port = repository();
    const client = provider();
    vi.mocked(port.getChangeSetSubmission).mockResolvedValue(submissionTarget as never);
    vi.mocked(client.listBranches).mockResolvedValue([{ name: "docs/update", sha: "upstream" }]);
    vi.mocked(client.readFile).mockResolvedValue("# Theirs");
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
      commitUrl: "commit-url",
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
    expect(port.completeJob).toHaveBeenCalledWith("job");
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
    expect(port.completeJob).toHaveBeenCalledWith("job");
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
    expect(port.failJob).toHaveBeenCalledWith("job", "Unsupported job kind: unsupported", true);
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
    expect(port.failJob).toHaveBeenCalledWith("job", "Change set is unavailable", false);
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
