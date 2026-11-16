import {
  BranchUpdateStrategy,
  branchConflictCache,
  branchConflictRepositoryKey,
  branchConflictResolutionSchema,
  branchUpdateStrategy,
  type ConflictReportMode,
  conflictReportLimits,
  isConflictMediaFile,
} from "@pushdocs/contracts";
import { McpError, RevisionConflictError } from "@pushdocs/db";
import type { z } from "zod";
import type { ProjectService } from "../project-service";
import { providerForConnection } from "../provider";
import {
  conflictReport,
  type conflictResolutionInput,
  conflictResolutions,
} from "./conflict-report";
import { publicOrigin } from "./origin";

export class ReviewService {
  constructor(
    private readonly service: ProjectService,
    private readonly grantId: string,
  ) {}

  private async connection(projectId: string) {
    await this.service.store.requireProjectAccess(this.service.userId, projectId);
    const target = await this.service.store.getProjectSyncTarget(projectId);
    if (!target) throw new McpError("PROJECT_NOT_FOUND", "Project connection is unavailable.", 404);
    return { target, provider: await providerForConnection(target) };
  }

  async list(projectId: string, targetBranch?: string, sourceBranch?: string) {
    const { target, provider } = await this.connection(projectId);
    const reviews = await provider.listChangeRequests(target.provider_repository_id, "open");
    return reviews
      .filter(
        (review) =>
          review.state === "open" &&
          (!targetBranch || review.targetBranch === targetBranch) &&
          (!sourceBranch || review.sourceBranch === sourceBranch),
      )
      .sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }))
      .map((review) => ({
        reviewId: review.id,
        title: review.title,
        url: review.url,
        branch: review.sourceBranch,
        targetBranch: review.targetBranch,
        headSha: review.headSha,
      }));
  }

  private async liveReview(projectId: string, reviewId: string, targetBranch?: string) {
    const { target, provider } = await this.connection(projectId);
    const review = (await provider.listChangeRequests(target.provider_repository_id, "open")).find(
      (review) => review.id === reviewId && review.state === "open",
    );
    if (!review || (targetBranch && review.targetBranch !== targetBranch))
      throw new McpError(
        "REVISION_CONFLICT",
        "PR / MR is closed or its target branch changed.",
        409,
      );
    const details = await provider.getChangeRequestDetails(target.provider_repository_id, reviewId);
    if (details.source?.isFork !== false)
      throw new McpError(
        "UNSUPPORTED_REVIEW_SOURCE",
        "Fork or unavailable PR / MR source branches are not supported.",
      );
    const branches = await provider.listBranches(target.provider_repository_id);
    const branch = branches.find((branch) => branch.name === review.sourceBranch);
    const incoming = branches.find((branch) => branch.name === review.targetBranch);
    if (
      !branch ||
      !incoming ||
      review.sourceBranch === review.targetBranch ||
      (review.headSha && review.headSha !== branch.sha) ||
      (details.headSha && details.headSha !== branch.sha)
    )
      throw new McpError(
        "REVISION_CONFLICT",
        "PR / MR branches changed. Reload the open reviews.",
        409,
      );
    return { target, provider, review, details, branches, branch, incoming };
  }

  private async remember(
    projectId: string,
    live: Awaited<ReturnType<ReviewService["liveReview"]>>,
  ) {
    await this.service.store.ensureBranches(
      projectId,
      live.branches.filter(
        (branch) =>
          branch.name === live.review.sourceBranch || branch.name === live.review.targetBranch,
      ),
    );
    return this.service.store.upsertOpenReview({
      projectId,
      externalId: live.review.id,
      headSha: live.branch.sha,
      sourceBranch: live.review.sourceBranch,
      targetBranch: live.review.targetBranch,
      title: live.review.title,
      url: live.review.url,
      details: live.details,
    });
  }

  private async blockedBranch(projectId: string, branch: string) {
    const blockers = await this.service.store.getBranchConflictBlockers(projectId, branch);
    if (!blockers.paths.length && !blockers.busy) return;
    return {
      status: "blocked",
      branch,
      reason: blockers.busy ? "branch_busy" : "unsubmitted_changes",
      paths: blockers.paths,
      activeOperationId: blockers.mergeJobId ?? null,
      editorUrl: new URL(
        `/projects/${encodeURIComponent(projectId)}/documents?${new URLSearchParams({ branch })}`,
        publicOrigin(),
      ).toString(),
      nextSteps: blockers.mergeFailed
        ? [
            "Inspect the existing failed operation with get_operation_status and use its supported resume flow, preserving the prepared result. Keep saved changes and skip this branch until recovery completes.",
          ]
        : blockers.busy
          ? [
              "Wait for the current operation or upload to finish, then inspect the branch again. Keep saved changes and skip this branch in the meantime.",
            ]
          : [
              "Review the entire shared change set, including other editors' changes, using get_change_set.",
              "If the user explicitly requests it, commit AND push the reviewed changes using submit_changes, then retry the branch update or resolution.",
              "The user can cancel explicitly selected unwanted changes in the editor, then retry.",
              "Otherwise keep the changes and skip this branch; continue the other open reviews.",
            ],
    };
  }

  private async queueWithAdvice(projectId: string, branch: string, queue: () => Promise<string>) {
    try {
      return { status: "queued", operationId: await queue() };
    } catch (error) {
      // Keep the queue's atomic checks and prepared-operation recovery authoritative.
      if (error instanceof RevisionConflictError) {
        const blocked = await this.blockedBranch(projectId, branch);
        if (blocked) return blocked;
      }
      throw error;
    }
  }

  async update(input: {
    projectId: string;
    reviewId: string;
    targetBranch: string;
    expectedHeadSha: string;
  }) {
    await this.service.store.requireProjectAccess(
      this.service.userId,
      input.projectId,
      "branch:push",
    );
    const live = await this.liveReview(input.projectId, input.reviewId, input.targetBranch);
    if (live.branch.sha !== input.expectedHeadSha)
      throw new McpError(
        "REVISION_CONFLICT",
        "The reviewed source branch changed. Reload before updating.",
        409,
      );
    if (live.branch.protected || live.branch.name === live.target.default_branch)
      throw new McpError(
        "ACCESS_DENIED",
        "Protected or default source branches cannot be updated.",
        403,
      );
    const stored = await this.remember(input.projectId, live);
    const result = await this.queueWithAdvice(input.projectId, live.review.sourceBranch, () =>
      this.service.store.queueReviewBranchUpdate({
        projectId: input.projectId,
        reviewId: stored.id,
        expectedHeadSha: input.expectedHeadSha,
        userId: this.service.userId,
        oauthGrantId: this.grantId,
        refreshFromTarget: true,
      }),
    );
    return {
      ...result,
      branch: live.review.sourceBranch,
      targetBranch: live.review.targetBranch,
      reviewUrl: live.review.url,
      strategy: branchUpdateStrategy(live.details) ?? BranchUpdateStrategy.Merge,
    };
  }

  async inspect(input: { projectId: string; reviewId: string; refresh: boolean }) {
    const live = await this.liveReview(input.projectId, input.reviewId);
    const stored = await this.remember(input.projectId, live);
    const operationId = await this.service.store.enqueueConflictInspection(
      {
        projectId: input.projectId,
        reviewId: stored.id,
        externalReviewId: live.review.id,
        branch: live.review.sourceBranch,
        sourceBranch: live.review.targetBranch,
        userId: this.service.userId,
        oauthGrantId: this.grantId,
        refresh: input.refresh,
      },
      input.refresh
        ? undefined
        : {
            parentSha: live.branch.sha,
            sourceSha: live.incoming.sha,
            repositoryKey: branchConflictRepositoryKey(live.target),
          },
    );
    return {
      operationId,
      inspectionId: operationId,
      status: "queued",
      branch: live.review.sourceBranch,
      comparisonKind: "merge",
      mediaPolicy: "metadata_only",
    };
  }

  private async inspection(projectId: string, inspectionId: string) {
    const { target, provider } = await this.connection(projectId);
    const inspection = await this.service.store.getMcpConflictInspection(projectId, inspectionId);
    if (!inspection)
      throw new McpError("OPERATION_NOT_FOUND", "Conflict inspection not found.", 404);
    if (inspection.status !== "done" || !inspection.snapshot)
      throw new McpError(
        "INSPECTION_NOT_READY",
        "Poll get_operation_status until the inspection completes.",
      );
    if (
      inspection.targetKey !== branchConflictRepositoryKey(target) ||
      inspection.snapshot.inspectionVersion !== branchConflictCache.version
    )
      throw new McpError(
        "REVISION_CONFLICT",
        "Repeat conflict inspection for the current repository.",
        409,
      );
    return { ...inspection, snapshot: inspection.snapshot, target, provider };
  }

  async report(input: {
    projectId: string;
    inspectionId: string;
    mode: ConflictReportMode;
    offset: number;
    limit: number;
    path?: string;
    fragmentOffset: number;
    referenceOffset?: number;
  }) {
    const { snapshot, target, provider, externalReviewId } = await this.inspection(
      input.projectId,
      input.inspectionId,
    );
    const [repository, branches, reviews] = await Promise.all([
      provider.getRepository(target.provider_repository_id),
      provider.listBranches(target.provider_repository_id),
      provider.listChangeRequests(target.provider_repository_id, "open"),
    ]);
    const review = reviews.find(
      (review) => review.id === externalReviewId && review.state === "open",
    );
    const stored = review
      ? undefined
      : (await this.service.store.listChangeRequests(input.projectId)).find(
          (review) => review.external_id === externalReviewId,
        );
    const details = review
      ? await provider.getChangeRequestDetails(target.provider_repository_id, externalReviewId)
      : null;
    const rebase = branchUpdateStrategy(details) === BranchUpdateStrategy.Rebase;
    const stale =
      !review ||
      review.sourceBranch !== snapshot.branch ||
      review.targetBranch !== snapshot.sourceBranch ||
      branches.find((branch) => branch.name === snapshot.branch)?.sha !== snapshot.parentSha ||
      branches.find((branch) => branch.name === snapshot.sourceBranch)?.sha !== snapshot.sourceSha;
    return {
      inspectionId: input.inspectionId,
      stale,
      resolutionSupported:
        !!snapshot.files.length && !stale && !rebase && !snapshot.unsupportedReason,
      limitation: rebase
        ? "This is a merge comparison of branch tips. It cannot describe or resolve conflicts encountered while replaying individual rebase commits. Do not silently switch a required rebase to merge."
        : null,
      ...conflictReport(
        snapshot,
        {
          appOrigin: publicOrigin(),
          repositoryUrl: repository.webUrl,
          provider: target.kind,
          projectId: input.projectId,
          rootPath: target.root_path,
          reviewUrl: review?.url ?? stored?.provider_url ?? repository.webUrl,
        },
        input,
      ),
    };
  }

  async file(input: {
    projectId: string;
    inspectionId: string;
    path: string;
    version: "base" | "branch" | "target";
    offset: number;
    limit: number;
  }) {
    const { snapshot } = await this.inspection(input.projectId, input.inspectionId);
    const file = snapshot.files.find((file) => file.path === input.path);
    if (!file) throw new McpError("FILE_NOT_FOUND", "Conflict file not found.", 404);
    if (file.kind !== "text" || isConflictMediaFile(file.path))
      throw new McpError(
        "MEDIA_CONTENT_EXCLUDED",
        "Media content is excluded from conflict text tools. Use the report's version links for an explicitly requested media review.",
      );
    const content =
      input.version === "base"
        ? file.baseContent
        : input.version === "branch"
          ? file.oursContent
          : file.theirsContent;
    const next = input.offset + input.limit;
    return {
      version: input.version,
      exists: content !== null,
      totalChars: content?.length ?? 0,
      content: content?.slice(input.offset, next) ?? null,
      nextOffset: content && next < content.length ? next : null,
      limit: conflictReportLimits.fileChars,
    };
  }

  async resolve(input: {
    projectId: string;
    inspectionId: string;
    files: z.infer<typeof conflictResolutionInput>;
  }) {
    await this.service.store.requireProjectAccess(
      this.service.userId,
      input.projectId,
      "branch:push",
    );
    const inspection = await this.inspection(input.projectId, input.inspectionId);
    const live = await this.liveReview(input.projectId, inspection.externalReviewId);
    const snapshot = inspection.snapshot;
    if (
      live.review.sourceBranch !== snapshot.branch ||
      live.review.targetBranch !== snapshot.sourceBranch ||
      live.branch.sha !== snapshot.parentSha ||
      live.incoming.sha !== snapshot.sourceSha
    )
      throw new McpError(
        "REVISION_CONFLICT",
        "Branches changed after analysis. Repeat conflict inspection.",
        409,
      );
    if (branchUpdateStrategy(live.details) === BranchUpdateStrategy.Rebase)
      throw new McpError(
        "REBASE_RESOLUTION_UNSUPPORTED",
        "A required rebase cannot be resolved using a merge snapshot.",
      );
    const files = branchConflictResolutionSchema.parse(conflictResolutions(snapshot, input.files));
    const result = await this.queueWithAdvice(input.projectId, snapshot.branch, () =>
      this.service.store.queueConflictMerge({
        projectId: input.projectId,
        inspectionId: input.inspectionId,
        files,
        userId: this.service.userId,
        oauthGrantId: this.grantId,
      }),
    );
    return {
      ...result,
      reviewUrl: live.review.url,
      branch: snapshot.branch,
      ...("operationId" in result ? { affectedFiles: files.map((file) => file.path) } : {}),
    };
  }
}
