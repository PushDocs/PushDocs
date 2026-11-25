import {
  BranchConflictChoice,
  type BranchConflictSnapshot,
  BranchUpdateStrategy,
  branchConflictCache,
  branchConflictRepositoryKey,
  branchUpdateConflictReference,
  branchUpdateLimits,
  ConflictReportMode,
  type RebaseProgress,
} from "@pushdocs/contracts";
import { PushDocsRepository } from "@pushdocs/db";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  inspectReviewConflictsAction,
  submitConflictResolutionAction,
} from "@/app/conflict-actions";
import { resolvedBranchUpdatePolicy } from "../../../../../tests/fixtures/branch-update-policy";
import { createMemoryDatabase } from "../../../../../tests/fixtures/database";
import { ProjectService } from "../project-service";
import { providerForConnection } from "../provider";
import { ReviewService } from "./reviews";

const browser = vi.hoisted(() => ({
  userId: "",
  store: undefined as PushDocsRepository | undefined,
}));
vi.mock("@/lib/server", () => ({
  requireUser: async () => ({ id: browser.userId }),
  repository: () => browser.store,
}));
vi.mock("../provider", () => ({ providerForConnection: vi.fn() }));

let database: Awaited<ReturnType<typeof createMemoryDatabase>>;
let store: PushDocsRepository;
let projectId: string;
let agentId: string;

beforeEach(async () => {
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", "https://pushdocs.test");
  database = await createMemoryDatabase();
  store = new PushDocsRepository(database);
  browser.store = store;
  const user = await store.createOperator({
    email: "browser@example.test",
    displayName: "Browser editor",
    passwordHash: "hash",
  });
  browser.userId = user.id;
  agentId = (
    await store.createUser({
      email: "agent@example.test",
      displayName: "MCP editor",
      passwordHash: "hash",
    })
  ).id;
  const connection = await store.createConnection({
    baseUrl: "https://git.example",
    kind: "gitlab",
    name: "Git",
    secretEncrypted: "test",
  });
  projectId = (
    await store.createProject({
      connectionId: connection.id,
      defaultBranch: "main",
      name: "Docs",
      operatorUserId: user.id,
      repositoryFullName: "test/docs",
      repositoryProviderId: "42",
      repositoryUrl: "https://git.example/test/docs.git",
      rootPath: ".",
      slug: "handoff",
    })
  ).id;
  await database
    .insertInto("project_memberships")
    .values({ project_id: projectId, user_id: agentId, role: "editor" })
    .execute();
  await store.ensureBranches(projectId, [
    { name: "docs/task", sha: "branch-head" },
    { name: "main", sha: "main-head" },
  ]);
});
afterEach(async () => {
  await database?.destroy();
});

async function fixture(strategy: BranchUpdateStrategy, hasReview = true) {
  const target = await store.getProjectSyncTarget(projectId);
  if (!target) throw new Error("Missing target");
  const repositoryKey = branchConflictRepositoryKey(target);
  const policy = resolvedBranchUpdatePolicy({ strategy, targetSha: "main-head" });
  const review = {
    id: "42",
    sourceBranch: "docs/task",
    targetBranch: "main",
    state: "open" as const,
    headSha: "branch-head",
    title: "Task",
    url: "https://git.example/test/docs/-/merge_requests/42",
  };
  vi.mocked(providerForConnection).mockResolvedValue({
    listChangeRequests: vi.fn().mockResolvedValue(hasReview ? [review] : []),
    listBranches: vi.fn().mockResolvedValue([
      { name: review.sourceBranch, sha: review.headSha },
      { name: review.targetBranch, sha: "main-head" },
    ]),
    getRepository: vi.fn().mockResolvedValue({
      webUrl: "https://git.example/test/docs",
      defaultUpdateStrategy: strategy,
    }),
    readFile: vi.fn().mockResolvedValue(JSON.stringify({ version: 1 })),
    getChangeRequestDetails: vi.fn().mockResolvedValue({
      source: { isFork: false },
      headSha: review.headSha,
      readiness: { state: "blocked", reason: "conflict" },
    }),
  } as never);
  const service = new ReviewService(new ProjectService(store, agentId), "current-grant");
  async function pause(operationId: string, index = 1) {
    const job = await database
      .selectFrom("jobs")
      .selectAll()
      .where("id", "=", operationId)
      .executeTakeFirstOrThrow();
    const attempt = job.attempts + 1;
    await database
      .updateTable("jobs")
      .set({ status: "running", attempts: attempt })
      .where("id", "=", operationId)
      .execute();
    const snapshot: BranchConflictSnapshot = {
      inspectionVersion: branchConflictCache.version,
      branch: review.sourceBranch,
      sourceBranch: review.targetBranch,
      parentSha: review.headSha,
      sourceSha: "main-head",
      updatePolicy: policy,
      files: [
        {
          path: "docs/a.md",
          kind: "text",
          baseContent: "Base",
          oursContent: "Branch",
          theirsContent: "Target",
          oursExists: true,
          theirsExists: true,
        },
      ],
    };
    const conflictId = `conflict-${index}`;
    if (strategy === BranchUpdateStrategy.Merge) {
      snapshot.merge = { operationId, conflictId };
      await store.pauseMergeUpdate(operationId, attempt, snapshot, repositoryKey);
    } else {
      snapshot.rebase = {
        operationId,
        conflictId,
        commitSha: `commit-${index}`,
        currentParentSha: `local-rebased-${index}`,
        originalParentSha: `original-parent-${index}`,
        index,
        total: 2,
        title: `Commit ${index}`,
      };
      const previous = (job.payload as { rebaseProgress?: RebaseProgress }).rebaseProgress;
      await store.pauseRebaseUpdate(
        operationId,
        attempt,
        previous ?? {
          version: branchUpdateLimits.version,
          branch: snapshot.branch,
          sourceBranch: snapshot.sourceBranch,
          parentSha: snapshot.parentSha,
          sourceSha: snapshot.sourceSha,
          originals: ["commit-1", "commit-2"],
          commits: [],
          resolutions: [],
        },
        snapshot,
        repositoryKey,
      );
    }
    return conflictId;
  }
  return { service, review, policy, repositoryKey, pause };
}

const decisions = [{ path: "docs/a.md", choice: BranchConflictChoice.Ours }];

it.each([
  [BranchUpdateStrategy.Merge, true],
  [BranchUpdateStrategy.Rebase, true],
  [BranchUpdateStrategy.Merge, false],
  [BranchUpdateStrategy.Rebase, false],
] as const)("continues UI %s through MCP with an open MR: %s", async (strategy, hasReview) => {
  const f = await fixture(strategy, hasReview);
  const id = await store.queueBranchUpdate({
    projectId,
    branch: f.review.sourceBranch,
    sourceBranch: f.review.targetBranch,
    expectedHeadSha: f.review.headSha,
    updatePolicy: f.policy,
    repositoryKey: f.repositoryKey,
    userId: browser.userId,
  });
  const conflictId = await f.pause(id);
  if (hasReview)
    expect(
      await f.service.inspect({ projectId, reviewId: f.review.id, refresh: true }),
    ).toMatchObject({
      operationId: id,
      inspectionId: id,
      status: "needs_resolution",
    });
  else
    expect(await store.getMcpBranchOperation(projectId, f.review.sourceBranch)).toMatchObject({
      operationId: id,
      status: "needs_resolution",
    });
  expect((await store.getBranchUpdateOperation(projectId, id))?.payload).toMatchObject({
    userId: browser.userId,
    branchOnly: true,
  });
  expect(
    await f.service.report({
      projectId,
      inspectionId: id,
      mode: ConflictReportMode.Editorial,
      offset: 0,
      limit: 5,
      fragmentOffset: 0,
    }),
  ).toMatchObject({ stale: false, resolutionSupported: true });
  await expect(
    f.service.resolve({
      projectId,
      inspectionId: id,
      conflictId: "old-token",
      files: [{ path: "docs/a.md", choice: "branch" }],
    }),
  ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
  expect(
    await f.service.resolve({
      projectId,
      inspectionId: id,
      conflictId,
      files: [{ path: "docs/a.md", choice: "branch" }],
    }),
  ).toMatchObject({ operationId: id, status: "queued" });
  expect((await store.getBranchUpdateOperation(projectId, id))?.payload).toMatchObject({
    userId: agentId,
    oauthGrantId: "current-grant",
    branchOnly: true,
  });
  // A retry through the other channel preserves the accepted decision and its authorization.
  expect(
    await submitConflictResolutionAction(
      projectId,
      id,
      decisions,
      strategy === BranchUpdateStrategy.Rebase ? conflictId : undefined,
      strategy === BranchUpdateStrategy.Merge ? conflictId : undefined,
    ),
  ).toBe(id);
  expect((await store.getBranchUpdateOperation(projectId, id))?.payload).toMatchObject({
    userId: agentId,
    oauthGrantId: "current-grant",
  });
  await expect(
    submitConflictResolutionAction(
      projectId,
      id,
      [{ path: "docs/a.md", choice: BranchConflictChoice.Theirs }],
      strategy === BranchUpdateStrategy.Rebase ? conflictId : undefined,
      strategy === BranchUpdateStrategy.Merge ? conflictId : undefined,
    ),
  ).rejects.toThrow("другое решение");
  expect(
    await database.selectFrom("jobs").select("id").where("kind", "=", "branch.update").execute(),
  ).toEqual([{ id }]);
});

it.each([BranchUpdateStrategy.Merge, BranchUpdateStrategy.Rebase])(
  "continues MCP %s through the UI with browser authorization",
  async (strategy) => {
    const f = await fixture(strategy);
    const queued = await f.service.update({
      projectId,
      reviewId: f.review.id,
      targetBranch: f.review.targetBranch,
      expectedHeadSha: f.review.headSha,
    });
    if (!("operationId" in queued) || !queued.operationId) throw new Error("Update was blocked");
    const id = queued.operationId;
    const conflictId = await f.pause(id);
    expect(await inspectReviewConflictsAction(projectId, branchUpdateConflictReference(id))).toBe(
      id,
    );
    expect(
      await submitConflictResolutionAction(
        projectId,
        id,
        decisions,
        strategy === BranchUpdateStrategy.Rebase ? conflictId : undefined,
        strategy === BranchUpdateStrategy.Merge ? conflictId : undefined,
      ),
    ).toBe(id);
    const payload = (await store.getBranchUpdateOperation(projectId, id))?.payload;
    expect(payload).toMatchObject({ userId: browser.userId, externalReviewId: f.review.id });
    expect(payload).not.toHaveProperty("oauthGrantId");
    if (strategy === BranchUpdateStrategy.Rebase) {
      const nextConflict = await f.pause(id, 2);
      await expect(
        f.service.resolve({
          projectId,
          inspectionId: id,
          conflictId,
          files: [{ path: "docs/a.md", choice: "target" }],
        }),
      ).rejects.toMatchObject({ code: "REVISION_CONFLICT" });
      expect(
        await f.service.resolve({
          projectId,
          inspectionId: id,
          conflictId: nextConflict,
          files: [{ path: "docs/a.md", choice: "target" }],
        }),
      ).toMatchObject({ operationId: id });
      expect((await store.getBranchUpdateOperation(projectId, id))?.payload).toMatchObject({
        oauthGrantId: "current-grant",
        userId: agentId,
        rebaseProgress: {
          resolutions: [
            { conflictId, files: decisions },
            {
              conflictId: nextConflict,
              files: [{ path: "docs/a.md", choice: BranchConflictChoice.Theirs }],
            },
          ],
        },
      });
    }
  },
);

it.each(["reader", null] as const)("checks current access in both channels: %s", async (role) => {
  const f = await fixture(BranchUpdateStrategy.Merge, false);
  const id = await store.queueBranchUpdate({
    projectId,
    branch: f.review.sourceBranch,
    sourceBranch: f.review.targetBranch,
    expectedHeadSha: f.review.headSha,
    updatePolicy: f.policy,
    repositoryKey: f.repositoryKey,
    userId: browser.userId,
  });
  const conflictId = await f.pause(id);
  const operatorId = browser.userId;
  await store.manageMember({ actorId: operatorId, projectId, userId: agentId, role });
  browser.userId = agentId;
  await expect(
    f.service.resolve({
      projectId,
      inspectionId: id,
      conflictId,
      files: [{ path: "docs/a.md", choice: "branch" }],
    }),
  ).rejects.toThrow();
  await expect(
    submitConflictResolutionAction(projectId, id, decisions, undefined, conflictId),
  ).rejects.toThrow();
  expect(await store.getBranchUpdateOperation(projectId, id)).toMatchObject({
    status: "needs_resolution",
    payload: { userId: operatorId },
  });
  await expect(
    f.service.report({
      projectId: "another-project",
      inspectionId: id,
      mode: ConflictReportMode.Editorial,
      offset: 0,
      limit: 5,
      fragmentOffset: 0,
    }),
  ).rejects.toThrow();
});
