import {
  BranchUpdateStrategy,
  branchConflictCache,
  branchConflictRepositoryKey,
  ConflictReportMode,
} from "@pushdocs/contracts";
import { type PushDocsRepository, RevisionConflictError } from "@pushdocs/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolvedBranchUpdatePolicy } from "../../../../../tests/fixtures/branch-update-policy";
import { ProjectService } from "../project-service";
import { providerForConnection } from "../provider";
import { ReviewService } from "./reviews";

vi.mock("../provider", () => ({ providerForConnection: vi.fn() }));
const target = {
  kind: "gitlab",
  root_path: ".",
  default_branch: "main",
  connection_id: "conn",
  base_url: "https://gitlab.test",
  provider_repository_id: "42",
  clone_url: "https://gitlab.test/g/docs.git",
} as const;
function fixture() {
  const review = {
    id: "814",
    sourceBranch: "doc/814",
    targetBranch: "stable",
    state: "open",
    headSha: "branch-sha",
    title: "Контакты",
    url: "https://gitlab.test/g/docs/-/merge_requests/814",
  };
  const snapshot = {
    updatePolicy: resolvedBranchUpdatePolicy({ targetSha: "stable-sha" }),
    branch: review.sourceBranch,
    sourceBranch: review.targetBranch,
    parentSha: "branch-sha",
    sourceSha: "stable-sha",
    inspectionVersion: branchConflictCache.version,
    files: [
      {
        path: "docs/a.md",
        kind: "text",
        oursExists: true,
        theirsExists: true,
        baseContent: "Base",
        oursContent: "Branch",
        theirsContent: "Target",
      },
      {
        path: "static/img/a.gif",
        kind: "binary",
        oursExists: true,
        theirsExists: false,
        baseContent: null,
        oursContent: null,
        theirsContent: null,
      },
    ],
  };
  const provider = {
    listChangeRequests: vi
      .fn()
      .mockResolvedValue([
        review,
        { ...review, id: "815", state: "merged" },
        { ...review, id: "816", targetBranch: "main" },
      ]),
    getChangeRequestDetails: vi.fn().mockResolvedValue({
      headSha: "branch-sha",
      source: { isFork: false },
      readiness: { state: "ready", reason: null },
    }),
    listBranches: vi.fn().mockResolvedValue([
      { name: review.sourceBranch, sha: "branch-sha" },
      { name: "stable", sha: "stable-sha" },
    ]),
    getRepository: vi.fn().mockResolvedValue({
      webUrl: "https://gitlab.test/g/docs",
      defaultUpdateStrategy: resolvedBranchUpdatePolicy().strategy,
    }),
    readBinary: vi.fn(),
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: 1 })),
  };
  vi.mocked(providerForConnection).mockResolvedValue(provider as never);
  const store = {
    requireProjectAccess: vi.fn(),
    getProjectSyncTarget: vi.fn().mockResolvedValue(target),
    ensureBranches: vi.fn(),
    upsertOpenReview: vi.fn().mockResolvedValue({ id: "stored-review" }),
    queueReviewBranchUpdate: vi.fn().mockResolvedValue("update-job"),
    enqueueConflictInspection: vi.fn().mockResolvedValue("inspection"),
    getActiveReviewBranchUpdate: vi.fn(),
    continueRebaseUpdate: vi.fn().mockResolvedValue("rebase-job"),
    queueConflictMerge: vi.fn().mockResolvedValue("resolve-job"),
    getBranchConflictBlockers: vi.fn().mockResolvedValue({ paths: [], busy: false }),
    getMcpConflictInspection: vi.fn().mockResolvedValue({
      status: "done",
      snapshot,
      externalReviewId: "814",
      targetKey: branchConflictRepositoryKey(target),
    }),
    listChangeRequests: vi.fn().mockResolvedValue([]),
  };
  const service = new ReviewService(
    new ProjectService(store as unknown as PushDocsRepository, "user"),
    "grant",
  );
  return { store, provider, review, snapshot, service };
}
beforeEach(() => {
  vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", "https://pushdocs.test");
});

describe("live review operations", () => {
  it("reports the actual paused commit and continues the same rebase using an exact conflict token", async () => {
    const f = fixture();
    const snapshot = {
      ...f.snapshot,
      updatePolicy: resolvedBranchUpdatePolicy({
        strategy: BranchUpdateStrategy.Rebase,
        targetSha: "stable-sha",
      }),
      rebase: {
        operationId: "rebase-job",
        conflictId: "exact-token",
        commitSha: "original-commit",
        currentParentSha: "local-rebased",
        originalParentSha: "original-parent",
        index: 2,
        total: 3,
        title: "Edit",
      },
    };
    f.store.getMcpConflictInspection.mockResolvedValue({
      status: "needs_resolution",
      snapshot,
      externalReviewId: "814",
      targetKey: branchConflictRepositoryKey(target),
    });
    f.store.getActiveReviewBranchUpdate.mockResolvedValue({
      id: "rebase-job",
      status: "needs_resolution",
    } as never);
    f.provider.getRepository.mockResolvedValue({
      webUrl: "https://gitlab.test/g/docs",
      defaultUpdateStrategy: BranchUpdateStrategy.Rebase,
    });
    expect(
      await f.service.inspect({ projectId: "project", reviewId: "814", refresh: true }),
    ).toMatchObject({
      operationId: "rebase-job",
      comparisonKind: "rebase",
      status: "needs_resolution",
    });
    expect(f.store.enqueueConflictInspection).not.toHaveBeenCalled();
    const report = await f.service.report({
      projectId: "project",
      inspectionId: "rebase-job",
      mode: ConflictReportMode.Editorial,
      offset: 0,
      limit: 10,
      fragmentOffset: 0,
    });
    expect(report).toMatchObject({
      comparisonKind: "rebase",
      resolutionSupported: true,
      rebase: { conflictId: "exact-token" },
    });
    expect(report.items[0]?.links).toMatchObject({
      branch: null,
      target: expect.stringContaining("/original-commit/"),
    });
    const input = {
      projectId: "project",
      inspectionId: "rebase-job",
      files: [
        { path: "docs/a.md", choice: "target" as const },
        { path: "static/img/a.gif", choice: "branch" as const },
      ],
    };
    await expect(f.service.resolve(input)).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
    await expect(f.service.resolve({ ...input, conflictId: "old-token" })).rejects.toMatchObject({
      code: "REVISION_CONFLICT",
    });
    expect(await f.service.resolve({ ...input, conflictId: "exact-token" })).toMatchObject({
      operationId: "rebase-job",
      status: "queued",
    });
    expect(f.store.continueRebaseUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: "rebase-job",
        conflictId: "exact-token",
        oauthGrantId: "grant",
      }),
    );
    expect(f.store.queueConflictMerge).not.toHaveBeenCalled();
    expect(f.provider.readBinary).not.toHaveBeenCalled();
  });

  it.each(["update", "resolve"] as const)(
    "returns editor advice for saved changes blocking %s",
    async (operation) => {
      const f = fixture();
      const queue =
        operation === "update" ? f.store.queueReviewBranchUpdate : f.store.queueConflictMerge;
      queue.mockRejectedValue(
        new RevisionConflictError("Сначала завершите текущие изменения в исходной ветке."),
      );
      f.store.getBranchConflictBlockers.mockResolvedValue({
        paths: ["docs/a.md", "static/img/a.gif"],
        busy: false,
      });
      const result =
        operation === "update"
          ? await f.service.update({
              projectId: "project",
              reviewId: "814",
              targetBranch: "stable",
              expectedHeadSha: "branch-sha",
            })
          : await f.service.resolve({
              projectId: "project",
              inspectionId: "inspection",
              files: [{ path: "docs/a.md", choice: "branch" }],
            });
      expect(result).toMatchObject({
        status: "blocked",
        reason: "unsubmitted_changes",
        paths: ["docs/a.md", "static/img/a.gif"],
        reviewUrl: f.review.url,
      });
      expect(result).not.toHaveProperty("operationId");
      if (!("nextSteps" in result)) throw new Error("Missing advice");
      expect(new URL(result.editorUrl).searchParams.get("branch")).toBe("doc/814");
      expect(result.nextSteps.join(" ")).toContain("explicitly requests");
      expect(result.nextSteps.join(" ")).toContain("including other editors");
      expect(result.nextSteps.join(" ")).not.toMatch(/stash/i);
      expect(f.provider.readBinary).not.toHaveBeenCalled();
    },
  );

  it("recommends waiting for active work and retains the existing queue's recovery behavior", async () => {
    const f = fixture();
    const args = {
      projectId: "project",
      reviewId: "814",
      targetBranch: "stable",
      expectedHeadSha: "branch-sha",
    };
    f.store.getBranchConflictBlockers.mockResolvedValue({ paths: [], busy: true });
    f.store.queueReviewBranchUpdate.mockRejectedValueOnce(new RevisionConflictError("busy"));
    const blocked = await f.service.update(args);
    expect(blocked).toMatchObject({
      status: "blocked",
      reason: "branch_busy",
      nextSteps: [expect.stringContaining("Wait")],
    });
    // The authoritative queue can resume its own prepared job despite a busy reservation.
    expect(await f.service.update(args)).toMatchObject({
      status: "queued",
      operationId: "update-job",
    });
  });

  it("propagates database failures without trying more queries in an aborted transaction", async () => {
    const f = fixture();
    f.store.queueReviewBranchUpdate.mockRejectedValue(
      Object.assign(new Error("database failed"), { code: "23514" }),
    );
    await expect(
      f.service.update({
        projectId: "project",
        reviewId: "814",
        targetBranch: "stable",
        expectedHeadSha: "branch-sha",
      }),
    ).rejects.toThrow("database failed");
    expect(f.store.getBranchConflictBlockers).not.toHaveBeenCalled();
  });

  it("filters exact live targets, excluding merged reviews without scanning repository branches", async () => {
    const f = fixture();
    expect(await f.service.list("project", "stable")).toEqual([
      expect.objectContaining({ reviewId: "814", targetBranch: "stable" }),
    ]);
    expect(f.provider.listBranches).not.toHaveBeenCalled();
    expect(f.store.upsertOpenReview).not.toHaveBeenCalled();
  });
  it("queues an explicit update even if the provider says ready, retaining OAuth and exact target", async () => {
    const f = fixture();
    expect(
      await f.service.update({
        projectId: "project",
        reviewId: "814",
        targetBranch: "stable",
        expectedHeadSha: "branch-sha",
      }),
    ).toMatchObject({ operationId: "update-job", strategy: "merge" });
    expect(f.store.queueReviewBranchUpdate).toHaveBeenCalledWith({
      projectId: "project",
      reviewId: "stored-review",
      expectedHeadSha: "branch-sha",
      expectedStrategy: "merge",
      userId: "user",
      oauthGrantId: "grant",
      refreshFromTarget: true,
    });
    expect(f.store.upsertOpenReview).toHaveBeenCalledWith(
      expect.objectContaining({ targetBranch: "stable" }),
    );
  });
  it.each(["closed", "moved-target", "moved-head", "fork", "protected", "default-source"])(
    "does not queue a %s update",
    async (reason) => {
      const f = fixture();
      if (reason === "closed") f.provider.listChangeRequests.mockResolvedValue([]);
      if (reason === "moved-target") f.review.targetBranch = "release";
      if (reason === "moved-head") f.review.headSha = "other";
      if (reason === "fork")
        f.provider.getChangeRequestDetails.mockResolvedValue({ source: { isFork: true } } as never);
      if (reason === "protected")
        f.provider.listBranches.mockResolvedValue([
          { name: "doc/814", sha: "branch-sha", protected: true },
          { name: "stable", sha: "stable-sha" },
        ] as never);
      if (reason === "default-source") {
        f.review.sourceBranch = "main";
        f.provider.listBranches.mockResolvedValue([
          { name: "main", sha: "branch-sha" },
          { name: "stable", sha: "stable-sha" },
        ]);
      }
      await expect(
        f.service.update({
          projectId: "project",
          reviewId: "814",
          targetBranch: "stable",
          expectedHeadSha: "branch-sha",
        }),
      ).rejects.toThrow();
      expect(f.store.queueReviewBranchUpdate).not.toHaveBeenCalled();
    },
  );
  it("creates a read-only inspection with the grant and live SHA cache key", async () => {
    const f = fixture();
    await f.service.inspect({ projectId: "project", reviewId: "814", refresh: false });
    expect(f.store.enqueueConflictInspection).toHaveBeenCalledWith(
      expect.objectContaining({ oauthGrantId: "grant", sourceBranch: "stable" }),
      expect.objectContaining({ parentSha: "branch-sha", sourceSha: "stable-sha" }),
    );
    expect(f.provider.readBinary).not.toHaveBeenCalled();
  });
});

describe("report and resolution safety", () => {
  it.each([ConflictReportMode.Editorial, ConflictReportMode.Detailed])(
    "marks changed snapshots stale and excludes binary reads in %s",
    async (mode) => {
      const f = fixture();
      f.provider.listBranches.mockResolvedValue([
        { name: "doc/814", sha: "branch-sha" },
        { name: "stable", sha: "new-sha" },
      ]);
      const report = await f.service.report({
        projectId: "project",
        inspectionId: "inspection",
        mode,
        offset: 0,
        limit: 5,
        fragmentOffset: 0,
      });
      expect(report.stale).toBe(true);
      expect(report.resolutionSupported).toBe(false);
      expect(f.provider.readBinary).not.toHaveBeenCalled();
      await expect(
        f.service.resolve({ projectId: "project", inspectionId: "inspection", files: [] }),
      ).rejects.toThrow("Branches changed");
      expect(f.store.queueConflictMerge).not.toHaveBeenCalled();
    },
  );
  it("provides complete text in chunks but rejects media through the text tool", async () => {
    const f = fixture();
    expect(
      await f.service.file({
        projectId: "project",
        inspectionId: "inspection",
        path: "docs/a.md",
        version: "branch",
        offset: 0,
        limit: 3,
      }),
    ).toMatchObject({ content: "Bra", nextOffset: 3 });
    expect(
      await f.service.file({
        projectId: "project",
        inspectionId: "inspection",
        path: "docs/a.md",
        version: "branch",
        offset: 3,
        limit: 3,
      }),
    ).toMatchObject({ content: "nch", nextOffset: null });
    await expect(
      f.service.file({
        projectId: "project",
        inspectionId: "inspection",
        path: "static/img/a.gif",
        version: "branch",
        offset: 0,
        limit: 100,
      }),
    ).rejects.toMatchObject({ code: "MEDIA_CONTENT_EXCLUDED" });
    expect(f.provider.readBinary).not.toHaveBeenCalled();
  });
  it("retains OAuth when publishing decisions and refuses required rebase via merge", async () => {
    const f = fixture();
    await f.service.resolve({
      projectId: "project",
      inspectionId: "inspection",
      files: [{ path: "docs/a.md", choice: "branch" }],
    });
    expect(f.store.queueConflictMerge).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthGrantId: "grant",
        files: [{ path: "docs/a.md", choice: "ours" }],
      }),
    );
    f.provider.getRepository.mockResolvedValue({ defaultUpdateStrategy: "rebase" } as never);
    await expect(
      f.service.resolve({ projectId: "project", inspectionId: "inspection", files: [] }),
    ).rejects.toMatchObject({ code: "REBASE_RESOLUTION_UNSUPPORTED" });
  });
});
