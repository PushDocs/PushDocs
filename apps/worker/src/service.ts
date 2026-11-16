import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeDocusaurusFiles,
  assertProjectFileEditable,
  isEditableFile,
  isMdxComponentsPath,
  isMediaFile,
  parseProjectConfig,
  registeredMdxComponents,
} from "@pushdocs/content";
import {
  type BranchConflictSnapshot,
  type BranchUpdatePolicy,
  BranchUpdateStrategy,
  branchConflictCache,
  branchConflictLimits,
  branchConflictRepositoryKey,
  branchConflictResolutionSchema,
  branchUpdateJobKind,
  branchUpdateMessages,
  branchUpdateStrategy,
  ConflictInspectionStage,
  isConflictMediaFile,
  mergeResolutionPolicyError,
  needsBranchUpdate,
  type PreparedBranchUpdate,
  projectConfigPaths,
  type RebaseProgress,
  sameBranchUpdatePolicy,
} from "@pushdocs/contracts";
import { decryptSecret, type PushDocsRepository } from "@pushdocs/db";
import {
  createProvider,
  type GitProvider,
  loadBranchUpdatePolicy,
  type ProviderFileChange,
  ProviderHttpError,
} from "@pushdocs/providers";
import { prepareVpnAccess, type VpnAccess, type VpnConnection } from "@pushdocs/vpn";
import {
  BranchMergeConflictError,
  GitTransport,
  type GitTransportOptions,
  RebaseNeedsResolution,
} from "./git-transport";

class BranchNotFoundError extends Error {
  constructor(branch: string) {
    super(`Branch ${branch} was not found`);
  }
}

class CloneOriginMismatchError extends Error {
  constructor() {
    super(
      "Адрес репозитория не совпадает с Git-подключением. Проверьте адрес подключения в настройках проекта.",
    );
  }
}

export type WorkerRepository = Pick<
  PushDocsRepository,
  | "claimNextJob"
  | "heartbeatJob"
  | "updateJobProgress"
  | "completeJob"
  | "ensureBranches"
  | "enqueueReviewCreation"
  | "enqueueReviewsSync"
  | "ensureProjectComponents"
  | "failJob"
  | "getChangeSetSubmission"
  | "getProjectSyncTarget"
  | "listActiveProjectIds"
  | "markChangeSetConflicted"
  | "markChangeSetSubmitted"
  | "markProjectAttention"
  | "releaseChangeSetSubmission"
  | "replaceChangeRequests"
  | "replaceImportedDocuments"
  | "requireProjectAccess"
  | "requireMcpGrant"
  | "savePreparedBranchMerge"
  | "savePreparedBranchUpdate"
  | "pauseRebaseUpdate"
  | "getActiveConflictMerge"
  | "saveConflictInspection"
  | "findConflictInspection"
  | "releaseBranchMergeReservation"
  | "savePreparedCommit"
  | "withGitRefLock"
  | "discardRejectedCommit"
>;

type ProjectSyncTarget = NonNullable<Awaited<ReturnType<WorkerRepository["getProjectSyncTarget"]>>>;

interface ProviderInput {
  baseUrl: string;
  kind: "github" | "gitlab";
  request?: VpnAccess["fetch"];
  token: string;
}

export interface WorkerServiceOptions {
  createUpdateTransport?: (
    input: GitTransportOptions,
  ) => Pick<GitTransport, "prepareUpdate" | "publish" | "isPublished">;
  createConflictTransport?: (
    input: GitTransportOptions,
  ) => Pick<GitTransport, "inspectConflicts" | "prepareMerge" | "publish" | "isPublished">;
  createMergeTransport?: (
    input: GitTransportOptions,
  ) => Pick<GitTransport, "prepareMerge" | "publish" | "isPublished">;
  createGitTransport?: (input: GitTransportOptions) => Pick<GitTransport, "prepare" | "publish">;
  gitRoot?: string;
  attachmentsRoot?: string;
  createProvider?: (input: ProviderInput) => GitProvider;
  decryptSecret?: (value: string) => string;
  logger?: Pick<Console, "error">;
  prepareVpnAccess?: (connection: VpnConnection) => Promise<VpnAccess>;
  readAttachment?: (filePath: string) => Promise<Uint8Array>;
  repository: WorkerRepository;
}

export function projectIdFromPayload(payload: unknown): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("projectId" in payload) ||
    typeof payload.projectId !== "string"
  ) {
    throw new Error("Job payload does not contain projectId");
  }
  return payload.projectId;
}

export function stringFromPayload(payload: unknown, key: string): string {
  if (
    typeof payload !== "object" ||
    payload === null ||
    !(key in payload) ||
    typeof payload[key as keyof typeof payload] !== "string"
  ) {
    throw new Error(`Job payload does not contain ${key}`);
  }
  return payload[key as keyof typeof payload] as string;
}

export function booleanFromPayload(payload: unknown, key: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as Record<string, unknown>)[key] === true;
}

export function repositoryPath(rootPath: string, relativePath: string): string {
  const root = rootPath === "." ? "" : rootPath.replace(/^\/+|\/+$/g, "");
  return root ? `${root}/${relativePath}` : relativePath;
}

export async function loadTextOrNull(
  provider: GitProvider,
  repositoryId: string,
  ref: string,
  filePath: string,
): Promise<string | null> {
  try {
    return await provider.readFile(repositoryId, ref, filePath);
  } catch (error) {
    if (
      (error instanceof ProviderHttpError && error.status === 404) ||
      (error instanceof Error && /\b404\b/.test(error.message))
    )
      return null;
    throw error;
  }
}

export function createWorkerService(options: WorkerServiceOptions) {
  const repository = options.repository;
  const providerFactory = options.createProvider ?? createProvider;
  const decrypt = options.decryptSecret ?? decryptSecret;
  const logger = options.logger ?? console;
  const readStoredAttachment = options.readAttachment ?? readFile;
  const vpnAccess = options.prepareVpnAccess ?? prepareVpnAccess;
  const attachmentsRoot = path.resolve(
    options.attachmentsRoot ?? process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "./data/attachments",
  );

  const providerAccessFor = async (target: {
    base_url: string;
    connection_id: string;
    kind: "github" | "gitlab";
    secret_encrypted: string;
    vpn_profile_encrypted: string | null;
    vpn_slot: number | null;
  }) => {
    const profile = target.vpn_profile_encrypted
      ? decrypt(target.vpn_profile_encrypted)
      : undefined;
    const access = profile
      ? await vpnAccess({
          allowedOrigin: target.base_url,
          connectionId: target.connection_id,
          profile,
          slot: target.vpn_slot,
        })
      : {
          /* v8 ignore next -- direct fetch is retained as the non-VPN access adapter. */
          fetch: (input: string | URL, init?: RequestInit) => fetch(input, init),
        };
    return {
      access,
      provider: providerFactory({
        baseUrl: target.base_url,
        kind: target.kind,
        ...(profile ? { request: access.fetch } : {}),
        token: decrypt(target.secret_encrypted),
      }),
    };
  };

  const providerFor = async (target: Parameters<typeof providerAccessFor>[0]) =>
    (await providerAccessFor(target)).provider;

  async function synchronizeReviews(
    projectId: string,
    provider: GitProvider,
    providerRepositoryId: string,
  ): Promise<void> {
    const requests = await provider.listChangeRequests(providerRepositoryId, "all");
    const hasOpenReviews = requests.some((request) => request.state === "open");
    const target = hasOpenReviews ? await repository.getProjectSyncTarget(projectId) : null;
    const branches = hasOpenReviews
      ? await provider.listBranches(providerRepositoryId).catch(() => [])
      : [];
    const policies = new Map<string, ReturnType<typeof loadBranchUpdatePolicy>>();
    const rows: Parameters<WorkerRepository["replaceChangeRequests"]>[1] = [];
    for (let offset = 0; offset < requests.length; offset += 8) {
      rows.push(
        ...(await Promise.all(
          requests.slice(offset, offset + 8).map(async (request) => {
            const providerDetails =
              request.state === "open"
                ? await provider.getChangeRequestDetails(providerRepositoryId, request.id)
                : null;
            const targetSha = branches.find((branch) => branch.name === request.targetBranch)?.sha;
            if (providerDetails && target && targetSha && !policies.has(targetSha))
              policies.set(
                targetSha,
                loadBranchUpdatePolicy(provider, providerRepositoryId, {
                  rootPath: target.root_path,
                  targetSha,
                }),
              );
            const details = providerDetails
              ? {
                  ...providerDetails,
                  branchUpdatePolicy: targetSha ? await policies.get(targetSha) : undefined,
                }
              : null;
            const headSha = details?.headSha || request.headSha || null;
            return {
              details,
              checks:
                request.state === "open" && headSha
                  ? await provider.listChecks(providerRepositoryId, headSha)
                  : [],
              externalId: request.id,
              headSha,
              sourceBranch: request.sourceBranch,
              sourceBranchIsLocal:
                request.sourceBranchIsLocal ?? (details?.source ? !details.source.isFork : null),
              state: request.state,
              targetBranch: request.targetBranch,
              title: request.title,
              url: request.url,
            };
          }),
        )),
      );
    }
    await repository.replaceChangeRequests(projectId, rows);
  }

  async function synchronizeBranch(
    projectId: string,
    branchName: string,
    provider?: GitProvider,
    onDocumentsLoaded?: (completed: number, total: number, receivedBytes: number) => Promise<void>,
  ): Promise<void> {
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Project sync target is unavailable or no longer granted");
    await repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${branchName}`,
      () => synchronizeBranchLocked(projectId, branchName, provider, onDocumentsLoaded),
    );
  }

  async function synchronizeBranchLocked(
    projectId: string,
    branchName: string,
    provider?: GitProvider,
    onDocumentsLoaded?: (completed: number, total: number, receivedBytes: number) => Promise<void>,
  ): Promise<void> {
    await onDocumentsLoaded?.(0, 0, 0);
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Project sync target is unavailable or no longer granted");
    const client = provider ?? (await providerFor(target));
    const branches = await client.listBranches(target.provider_repository_id);
    await repository.ensureBranches(projectId, branches);
    const branch = branches.find((item) => item.name === branchName);
    if (!branch) throw new BranchNotFoundError(branchName);
    const allPaths = await client.listFiles(target.provider_repository_id, branch.sha);
    const configPath = repositoryPath(target.root_path, ".pushdocs/config.json");
    const configContent = allPaths.includes(configPath)
      ? await client.readFile(target.provider_repository_id, branch.sha, configPath)
      : null;
    const config = parseProjectConfig(configContent);
    let receivedBytes = Buffer.byteLength(configContent ?? "", "utf8");
    const prefix = target.root_path === "." ? "" : `${target.root_path.replace(/\/$/, "")}/`;
    const paths = allPaths.filter(
      (filePath) =>
        filePath.startsWith(prefix) &&
        (isEditableFile(config, filePath.slice(prefix.length)) ||
          isMdxComponentsPath(filePath.slice(prefix.length))),
    );
    await onDocumentsLoaded?.(0, paths.length, receivedBytes);
    const contents = new Map<string, string>();
    for (let offset = 0; offset < paths.length; offset += 12) {
      const batch = paths.slice(offset, offset + 12);
      const loaded = await Promise.all(
        batch.map(
          async (filePath) =>
            [
              filePath,
              await client.readFile(target.provider_repository_id, branch.sha, filePath),
            ] as const,
        ),
      );
      for (const [filePath, content] of loaded) {
        contents.set(filePath, content);
        receivedBytes += Buffer.byteLength(content, "utf8");
      }
      await onDocumentsLoaded?.(contents.size, paths.length, receivedBytes);
    }
    const profile = analyzeDocusaurusFiles(contents, target.root_path);
    const existing = new Set(profile.documents.map((document) => document.path));
    for (const [filePath, content] of contents) {
      const relativePath = filePath.slice(prefix.length);
      if (!existing.has(relativePath))
        profile.documents.push({
          path: relativePath,
          content,
          contentHash: createHash("sha256").update(content).digest("hex"),
          title: relativePath.split("/").at(-1) ?? relativePath,
          locale: "default",
          version: "current",
          status: "clean",
        });
    }
    await repository.replaceImportedDocuments(
      projectId,
      branch.name,
      branch.sha,
      profile.documents,
      allPaths
        .filter((filePath) => filePath.startsWith(prefix))
        .map((filePath) => filePath.slice(prefix.length)),
    );
    const registered = [...contents].flatMap(([filePath, content]) =>
      isMdxComponentsPath(filePath.slice(prefix.length))
        ? (registeredMdxComponents(content, filePath) ?? [])
        : [],
    );
    await repository.ensureProjectComponents(projectId, [
      ...new Set([...profile.unknownComponents, ...registered]),
    ]);
  }

  async function synchronizeProject(projectId: string): Promise<void> {
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Project sync target is unavailable or no longer granted");
    const provider = await providerFor(target);
    const branches = await provider.listBranches(target.provider_repository_id);
    await repository.ensureBranches(projectId, branches);
    await synchronizeBranch(projectId, target.default_branch, provider);
    await synchronizeReviews(projectId, provider, target.provider_repository_id);
  }

  function optionalPayloadString(payload: unknown, key: string): string | undefined {
    if (!payload || typeof payload !== "object") return undefined;
    const value = (payload as Record<string, unknown>)[key];
    return typeof value === "string" ? value : undefined;
  }
  async function checkMcpAuthorization(payload: unknown, scope: string) {
    const grantId = optionalPayloadString(payload, "oauthGrantId");
    if (grantId)
      await repository.requireMcpGrant(
        grantId,
        stringFromPayload(payload, "userId"),
        projectIdFromPayload(payload),
        scope,
      );
  }

  async function createBranch(
    payload: unknown,
    onProgress: (progress: string, counts?: { completed: number; total: number }) => Promise<void>,
  ): Promise<void> {
    await checkMcpAuthorization(payload, "pushdocs:write");
    await onProgress("checking-source");
    const projectId = projectIdFromPayload(payload);
    const userId = stringFromPayload(payload, "userId");
    const branchName = stringFromPayload(payload, "branch");
    const sourceBranch = stringFromPayload(payload, "sourceBranch");
    const sourceSha = stringFromPayload(payload, "sourceSha");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    const provider = await providerFor(target);
    const branches = await provider.listBranches(target.provider_repository_id);
    const source = branches.find((branch) => branch.name === sourceBranch);
    if (!source || source.sha !== sourceSha)
      throw new Error("Исходная ветка обновилась. Получите изменения и повторите создание.");
    const existing = branches.find((branch) => branch.name === branchName);
    if (existing && existing.sha !== sourceSha)
      throw new Error(`Ветка ${branchName} уже существует и содержит другие изменения`);
    await onProgress("creating-branch");
    if (!existing) {
      await checkMcpAuthorization(payload, "pushdocs:write");
      await repository.requireProjectAccess(userId, projectId, "branch:push");
      await provider.createBranch(target.provider_repository_id, branchName, sourceSha);
    }
    await onProgress("importing-documents");
    await synchronizeBranch(projectId, branchName, provider, (completed, total) =>
      onProgress("importing-documents", { completed, total }),
    );
  }

  function gitTransportOptions(
    target: NonNullable<Awaited<ReturnType<WorkerRepository["getProjectSyncTarget"]>>>,
    operationId: string,
    access: Pick<VpnAccess, "gitProxyUrl">,
  ): GitTransportOptions {
    const token = decrypt(target.secret_encrypted);
    const remote = new URL(target.clone_url);
    const connection = new URL(target.base_url);
    // GitLab behind an HTTPS proxy can advertise an HTTP clone URL for the same host.
    if (
      remote.protocol === "http:" &&
      connection.protocol === "https:" &&
      remote.hostname === connection.hostname &&
      !remote.port &&
      !connection.port
    ) {
      remote.protocol = "https:";
    }
    if (remote.origin !== connection.origin) throw new CloneOriginMismatchError();
    return {
      directory: path.join(
        path.resolve(options.gitRoot ?? process.env.PUSHDOCS_GIT_CACHE_DIR ?? "./data/git"),
        createHash("sha256").update(operationId).digest("hex"),
      ),
      remote: remote.href,
      authorization: `Authorization: Basic ${Buffer.from(`${target.kind === "gitlab" ? "oauth2" : "x-access-token"}:${token}`).toString("base64")}`,
      proxyUrl: access.gitProxyUrl,
    };
  }

  function mergeTargetKey(target: Parameters<typeof gitTransportOptions>[0]) {
    return JSON.stringify([
      target.connection_id,
      target.base_url,
      target.provider_repository_id,
      target.clone_url,
      target.kind,
    ]);
  }

  async function requireConflictReview(
    payload: unknown,
    provider: GitProvider,
    target: ProjectSyncTarget,
  ) {
    const repositoryId = target.provider_repository_id;
    const reviewId = stringFromPayload(payload, "externalReviewId");
    const review = (await provider.listChangeRequests(repositoryId)).find(
      (item) => item.id === reviewId,
    );
    if (
      review?.state !== "open" ||
      review.sourceBranch !== stringFromPayload(payload, "branch") ||
      review.targetBranch !== stringFromPayload(payload, "sourceBranch")
    )
      throw new BranchMergeConflictError(
        "PR / MR закрыт или его ветки изменились. Обновите данные из Git.",
      );
    const details = await provider.getChangeRequestDetails(repositoryId, reviewId);
    if (details?.source?.isFork !== false)
      throw new BranchMergeConflictError("Разрешение конфликтов веток из форков недоступно.");
    const branches = await provider.listBranches(repositoryId);
    const targetSha = branches.find((branch) => branch.name === review.targetBranch)?.sha;
    if (!targetSha) throw new BranchNotFoundError(review.targetBranch);
    return {
      ...review,
      details: {
        ...details,
        branchUpdatePolicy: await loadBranchUpdatePolicy(provider, repositoryId, {
          rootPath: target.root_path,
          targetSha,
        }),
      },
      branches,
    };
  }

  async function restrictConflictSnapshot(
    snapshot: BranchConflictSnapshot,
    target: ProjectSyncTarget,
    provider: GitProvider,
  ) {
    const root = target.root_path === "." ? "" : `${target.root_path.replace(/^\/+|\/+$/g, "")}/`;
    const config = parseProjectConfig(
      await loadTextOrNull(
        provider,
        target.provider_repository_id,
        snapshot.parentSha,
        repositoryPath(target.root_path, projectConfigPaths.config),
      ),
    );
    for (const file of snapshot.files) {
      if (
        !file.path.startsWith(root) ||
        (!isEditableFile(config, file.path.slice(root.length)) && !isConflictMediaFile(file.path))
      ) {
        file.kind = "unsupported";
        file.baseContent = file.oursContent = file.theirsContent = null;
        file.sections = undefined;
        file.mediaReferences = undefined;
        snapshot.unsupportedReason =
          "Часть конфликтов находится вне редактируемых файлов проекта. Разрешите их в Git-провайдере.";
      }
    }
  }

  async function inspectBranchConflicts(payload: unknown, jobId: string, attempt: number) {
    await checkMcpAuthorization(payload, "pushdocs:read");
    const projectId = projectIdFromPayload(payload);
    await repository.updateJobProgress(
      jobId,
      attempt,
      ConflictInspectionStage.Preparing,
      undefined,
      { receivedBytes: 0, totalBytes: null },
    );
    await repository.requireProjectAccess(
      stringFromPayload(payload, "userId"),
      projectId,
      "project:read",
    );
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    const { provider, access } = await providerAccessFor(target);
    const review = await requireConflictReview(payload, provider, target);
    const branches = review.branches;
    const parentSha = branches.find((item) => item.name === review.sourceBranch)?.sha;
    const sourceSha = branches.find((item) => item.name === review.targetBranch)?.sha;
    if (!parentSha || !sourceSha)
      throw new BranchNotFoundError(!parentSha ? review.sourceBranch : review.targetBranch);
    const repositoryKey = branchConflictRepositoryKey(target);
    const cached = !booleanFromPayload(payload, "refresh")
      ? await repository.findConflictInspection({
          projectId,
          reviewId: stringFromPayload(payload, "reviewId"),
          branch: review.sourceBranch,
          sourceBranch: review.targetBranch,
          parentSha,
          sourceSha,
          repositoryKey,
          updatePolicy: review.details.branchUpdatePolicy,
        })
      : undefined;
    if (cached) {
      await repository.saveConflictInspection(
        jobId,
        attempt,
        {
          ...cached.snapshot,
          updatePolicy: review.details.branchUpdatePolicy,
        },
        repositoryKey,
      );
      return;
    }
    const cacheIdentity = JSON.stringify([
      repositoryKey,
      parentSha,
      sourceSha,
      branchConflictCache.version,
    ]);
    await repository.withGitRefLock(`inspection:${cacheIdentity}`, async () => {
      let progressWrites = Promise.resolve();
      let lastWrite = 0;
      let previousStage: ConflictInspectionStage | undefined;
      let latest: Parameters<NonNullable<GitTransportOptions["onProgress"]>>[0] | undefined;
      const writeProgress = (progress: NonNullable<typeof latest>) => {
        progressWrites = progressWrites
          .then(() =>
            repository.updateJobProgress(
              jobId,
              attempt,
              progress.stage,
              progress.counts,
              progress.transfer,
            ),
          )
          .catch(() => undefined);
      };
      const onProgress: NonNullable<GitTransportOptions["onProgress"]> = (progress) => {
        latest = progress;
        if (
          progress.stage !== previousStage ||
          Date.now() - lastWrite >= branchConflictLimits.progressMs
        ) {
          previousStage = progress.stage;
          lastWrite = Date.now();
          writeProgress(progress);
        }
      };
      const transport = (options.createConflictTransport ?? ((input) => new GitTransport(input)))({
        ...gitTransportOptions(target, `inspection:${cacheIdentity}`, access),
        onProgress,
      });
      let snapshot: BranchConflictSnapshot;
      try {
        snapshot = await transport.inspectConflicts({
          branch: review.sourceBranch,
          sourceBranch: review.targetBranch,
          ...(target.root_path === "." ? {} : { rootPath: target.root_path }),
        });
      } finally {
        if (latest) writeProgress(latest);
        await progressWrites;
      }
      if (snapshot.sourceSha !== review.details.branchUpdatePolicy.targetSha)
        throw new BranchMergeConflictError(
          "Целевая ветка обновилась. Заново получите список конфликтов.",
        );
      snapshot.updatePolicy = review.details.branchUpdatePolicy;
      await repository.updateJobProgress(
        jobId,
        attempt,
        ConflictInspectionStage.Finalizing,
        undefined,
        latest?.transfer,
      );
      await restrictConflictSnapshot(snapshot, target, provider);
      await repository.ensureBranches(projectId, branches);
      await repository.saveConflictInspection(jobId, attempt, snapshot, repositoryKey);
    });
  }

  async function requireMergeResolutionReview(
    payload: unknown,
    provider: GitProvider,
    target: ProjectSyncTarget,
  ) {
    const review = await requireConflictReview(payload, provider, target);
    const policyError = mergeResolutionPolicyError(review.details.branchUpdatePolicy);
    if (policyError) throw new BranchMergeConflictError(policyError);
    const snapshot = (payload as { resolutionSnapshot: BranchConflictSnapshot }).resolutionSnapshot;
    if (!sameBranchUpdatePolicy(snapshot.updatePolicy, review.details.branchUpdatePolicy))
      throw new BranchMergeConflictError(branchUpdateMessages.changed);
    return review;
  }

  async function resolveBranchConflicts(
    payload: Record<string, unknown>,
    jobId: string,
    createdAt: string,
    attempt: number,
  ) {
    await checkMcpAuthorization(payload, "pushdocs:submit");
    const projectId = projectIdFromPayload(payload);
    const userId = stringFromPayload(payload, "userId");
    const accessRole = await repository.requireProjectAccess(userId, projectId, "branch:push");
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    if (payload.targetKey !== branchConflictRepositoryKey(target))
      throw new (payload.preparedMerge ? Error : BranchMergeConflictError)(
        "Подключение проекта изменилось. Заново получите список конфликтов.",
      );
    const snapshot = payload.resolutionSnapshot as BranchConflictSnapshot;
    const files = branchConflictResolutionSchema.parse(payload.resolutionFiles);
    const { provider, access } = await providerAccessFor(target);
    await repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${snapshot.branch}`,
      async () => {
        const transport = (options.createConflictTransport ?? ((input) => new GitTransport(input)))(
          gitTransportOptions(target, jobId, access),
        );
        const saved = payload.preparedMerge as Parameters<
          GitTransport["prepareMerge"]
        >[0]["prepared"];
        if (saved && (await transport.isPublished(saved))) {
          await synchronizeBranchLocked(projectId, snapshot.branch, provider);
          await repository.enqueueReviewsSync(projectId);
          return;
        }
        const review = await requireMergeResolutionReview(payload, provider, target);
        const branch = review.branches.find((item) => item.name === snapshot.branch);
        if (!branch || branch.protected || snapshot.branch === target.default_branch)
          throw new BranchMergeConflictError("Исходная ветка недоступна для записи.");
        if (
          branch.sha !== snapshot.parentSha ||
          review.branches.find((item) => item.name === snapshot.sourceBranch)?.sha !==
            snapshot.sourceSha
        )
          throw new BranchMergeConflictError(
            "Целевая ветка обновилась. Заново получите список конфликтов.",
          );
        const prepared = saved
          ? await transport.prepareMerge({
              branch: snapshot.branch,
              sourceBranch: snapshot.sourceBranch,
              createdAt,
              prepared: saved,
              resolution: { snapshot, files },
            })
          : undefined;
        if (prepared && prepared.sha !== saved?.sha)
          throw new Error(
            "Не удалось восстановить исходный коммит слияния. Отправка остаётся приостановленной до проверки результата.",
          );
        {
          const config = parseProjectConfig(
            await loadTextOrNull(
              provider,
              target.provider_repository_id,
              snapshot.parentSha,
              repositoryPath(target.root_path, projectConfigPaths.config),
            ),
          );
          const root =
            target.root_path === "." ? "" : `${target.root_path.replace(/^\/+|\/+$/g, "")}/`;
          for (const file of files) {
            if (!file.path.startsWith(root))
              throw new BranchMergeConflictError("Файл находится вне проекта");
            const relative = file.path.slice(root.length);
            if (!isConflictMediaFile(relative))
              assertProjectFileEditable(config, relative, accessRole.role);
          }
          const commit =
            prepared ??
            (await transport.prepareMerge({
              branch: snapshot.branch,
              sourceBranch: snapshot.sourceBranch,
              createdAt,
              resolution: { snapshot, files },
            }));
          await repository.savePreparedBranchMerge(jobId, attempt, {
            ...commit,
            targetKey: branchConflictRepositoryKey(target),
          });
          await repository.requireProjectAccess(userId, projectId, "branch:push");
          const currentTarget = await repository.getProjectSyncTarget(projectId);
          if (
            !currentTarget ||
            branchConflictRepositoryKey(currentTarget) !== branchConflictRepositoryKey(target)
          )
            throw new BranchMergeConflictError(
              "Подключение проекта изменилось. Отправка остановлена.",
            );
          await requireMergeResolutionReview(payload, provider, target);
          const currentBranches = await provider.listBranches(target.provider_repository_id);
          const currentBranch = currentBranches.find((item) => item.name === snapshot.branch);
          if (
            !currentBranch ||
            currentBranch.protected ||
            currentBranch.sha !== snapshot.parentSha ||
            snapshot.branch === currentTarget.default_branch ||
            currentBranches.find((item) => item.name === snapshot.sourceBranch)?.sha !==
              snapshot.sourceSha
          )
            throw new BranchMergeConflictError(
              "Ветки изменились перед отправкой. Заново получите список конфликтов.",
            );
          await checkMcpAuthorization(payload, "pushdocs:submit");
          await transport.publish(commit);
        }
        await synchronizeBranchLocked(projectId, snapshot.branch, provider);
        await repository.enqueueReviewsSync(projectId);
      },
    );
  }

  async function mergeBranch(
    payload: unknown,
    operationId: string,
    createdAt: string,
    attempt: number,
  ) {
    const projectId = projectIdFromPayload(payload);
    const branch = stringFromPayload(payload, "branch");
    const sourceBranch = stringFromPayload(payload, "sourceBranch");
    const userId = stringFromPayload(payload, "userId");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    const activeUpdate = await repository.getActiveConflictMerge(projectId, branch);
    if (activeUpdate && activeUpdate.id !== operationId)
      throw new BranchMergeConflictError("Ветка уже обновляется. Дождитесь завершения операции.");
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    const targetKey = mergeTargetKey(target);
    const journal = (payload as Record<string, unknown>).preparedMerge;
    if (journal && stringFromPayload(journal, "targetKey") !== targetKey)
      throw new BranchMergeConflictError(
        "Репозиторий или подключение изменились после подготовки слияния. Исходная операция остановлена.",
      );
    await repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${branch}`,
      async () => {
        const { provider, access } = await providerAccessFor(target);
        const branches = await provider.listBranches(target.provider_repository_id);
        const destination = branches.find((item) => item.name === branch);
        if (!destination) throw new BranchNotFoundError(branch);
        const transport = (options.createMergeTransport ?? ((input) => new GitTransport(input)))(
          gitTransportOptions(target, operationId, access),
        );
        const savedMerge = journal
          ? {
              branch: stringFromPayload(journal, "branch"),
              parentSha: stringFromPayload(journal, "parentSha"),
              sourceSha: stringFromPayload(journal, "sourceSha"),
              sha: stringFromPayload(journal, "sha"),
            }
          : undefined;
        if (savedMerge && (await transport.isPublished(savedMerge))) {
          await synchronizeBranchLocked(projectId, branch, provider);
          return;
        }
        if (sourceBranch !== target.default_branch || branch === target.default_branch)
          throw new BranchMergeConflictError(
            "Основная ветка проекта изменилась. Обновите страницу и повторите операцию.",
          );
        if (destination.protected)
          throw new BranchMergeConflictError(
            "Защищённую ветку нельзя обновить слиянием из PushDocs.",
          );
        const incoming = branches.find((item) => item.name === sourceBranch);
        if (!incoming) throw new BranchNotFoundError(sourceBranch);
        const updatePolicy = await loadBranchUpdatePolicy(provider, target.provider_repository_id, {
          rootPath: target.root_path,
          targetSha: incoming.sha,
        });
        const policyError = mergeResolutionPolicyError(updatePolicy);
        if (policyError) throw new BranchMergeConflictError(policyError);
        if (
          savedMerge &&
          !sameBranchUpdatePolicy(
            (journal as { updatePolicy?: BranchUpdatePolicy }).updatePolicy,
            updatePolicy,
          )
        )
          throw new BranchMergeConflictError(branchUpdateMessages.changed);
        const prepared = await transport.prepareMerge({
          branch,
          sourceBranch,
          createdAt,
          ...(savedMerge ? { prepared: savedMerge } : {}),
        });
        if (savedMerge && prepared.sha !== savedMerge.sha)
          throw new BranchMergeConflictError(
            "Не удалось восстановить исходный коммит слияния. Отправка остановлена.",
          );
        await repository.savePreparedBranchMerge(operationId, attempt, {
          ...prepared,
          targetKey,
          updatePolicy,
        });
        await repository.requireProjectAccess(userId, projectId, "branch:push");
        const currentTarget = await repository.getProjectSyncTarget(projectId);
        if (
          !currentTarget ||
          mergeTargetKey(currentTarget) !== targetKey ||
          currentTarget.default_branch !== sourceBranch
        )
          throw new BranchMergeConflictError(
            "Подключение или основная ветка проекта изменились. Повторите операцию.",
          );
        const currentBranches = await provider.listBranches(target.provider_repository_id);
        const currentBranch = currentBranches.find((item) => item.name === branch);
        if (
          !currentBranch ||
          currentBranch.protected ||
          currentBranch.sha !== prepared.parentSha ||
          currentBranches.find((item) => item.name === sourceBranch)?.sha !== prepared.sourceSha
        )
          throw new BranchMergeConflictError(
            "Ветки обновились перед отправкой. Повторите операцию.",
          );
        const finalPolicy = await loadBranchUpdatePolicy(provider, target.provider_repository_id, {
          rootPath: currentTarget.root_path,
          targetSha: prepared.sourceSha,
        });
        if (!sameBranchUpdatePolicy(updatePolicy, finalPolicy))
          throw new BranchMergeConflictError(branchUpdateMessages.changed);
        await transport.publish(prepared);
        try {
          await synchronizeBranchLocked(projectId, branch, provider);
        } catch (error) {
          throw new Error(
            `Слияние подтверждено в Git, но документы не обновлены: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    );
  }

  async function updateReviewBranch(
    payload: Record<string, unknown>,
    jobId: string,
    createdAt: string,
    attempt: number,
  ) {
    await checkMcpAuthorization(payload, "pushdocs:submit");
    const projectId = projectIdFromPayload(payload);
    const userId = stringFromPayload(payload, "userId");
    const branch = stringFromPayload(payload, "branch");
    const sourceBranch = stringFromPayload(payload, "sourceBranch");
    const strategy = stringFromPayload(payload, "strategy");
    if (strategy !== BranchUpdateStrategy.Rebase && strategy !== BranchUpdateStrategy.Merge)
      throw new BranchMergeConflictError("Неизвестный способ обновления ветки.");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Подключение проекта недоступно");
    const targetKey = mergeTargetKey(target);
    const rebase = payload.rebaseProgress as RebaseProgress | undefined;
    const saved = payload.preparedUpdate as
      | (PreparedBranchUpdate & { targetKey: string })
      | undefined;
    if (saved && saved.targetKey !== targetKey)
      throw new BranchMergeConflictError("Репозиторий изменился после подготовки обновления.");
    const { provider, access } = await providerAccessFor(target);
    return repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${branch}`,
      async () => {
        const transport = (options.createUpdateTransport ?? ((input) => new GitTransport(input)))(
          gitTransportOptions(target, jobId, access),
        );
        const synchronize = async () => {
          await synchronizeBranchLocked(projectId, branch, provider);
          await synchronizeReviews(projectId, provider, target.provider_repository_id);
        };
        // An acknowledged push is never recalculated against newer branch heads.
        if (saved && (await transport.isPublished(saved))) {
          await synchronize();
          return;
        }
        if (rebase && payload.targetKey !== branchConflictRepositoryKey(target))
          throw new BranchMergeConflictError("Подключение проекта изменилось во время rebase.");
        const review = await requireConflictReview(payload, provider, target);
        const branches = await provider.listBranches(target.provider_repository_id);
        const destination = branches.find((item) => item.name === branch);
        const incoming = branches.find((item) => item.name === sourceBranch);
        if (!destination || !incoming || destination.protected || branch === target.default_branch)
          throw new BranchMergeConflictError(
            "Исходная ветка недоступна для обновления из PushDocs.",
          );
        if (
          !sameBranchUpdatePolicy(
            payload.updatePolicy as typeof review.details.branchUpdatePolicy,
            review.details.branchUpdatePolicy,
          ) ||
          branchUpdateStrategy(review.details) !== strategy
        )
          throw new BranchMergeConflictError(
            review.details.branchUpdatePolicy.error ?? branchUpdateMessages.changed,
          );
        if (
          destination.sha !== (saved?.parentSha ?? payload.expectedHeadSha) ||
          incoming.sha !== (saved?.sourceSha ?? review.details.branchUpdatePolicy.targetSha) ||
          (!saved &&
            !rebase &&
            (review.headSha !== destination.sha ||
              (!needsBranchUpdate(review.details) && !payload.refreshFromTarget)))
        )
          throw new BranchMergeConflictError(
            "Состояние PR / MR изменилось. Обновите данные из Git.",
          );
        if (rebase?.resolutions.length) {
          const writer = await repository.requireProjectAccess(userId, projectId, "branch:push");
          const config = parseProjectConfig(
            await loadTextOrNull(
              provider,
              target.provider_repository_id,
              rebase.parentSha,
              repositoryPath(target.root_path, projectConfigPaths.config),
            ),
          );
          const root =
            target.root_path === "." ? "" : `${target.root_path.replace(/^\/+|\/+$/g, "")}/`;
          for (const resolution of rebase.resolutions)
            for (const file of resolution.files) {
              if (!file.path.startsWith(root))
                throw new BranchMergeConflictError("Файл находится вне проекта");
              if (!isConflictMediaFile(file.path))
                assertProjectFileEditable(config, file.path.slice(root.length), writer.role);
            }
        }
        let prepared: PreparedBranchUpdate;
        try {
          prepared = await transport.prepareUpdate({
            branch,
            sourceBranch,
            strategy,
            createdAt,
            operationId: jobId,
            ...(target.root_path === "." ? {} : { rootPath: target.root_path }),
            ...(saved ? { prepared: saved } : {}),
            ...(rebase ? { rebase } : {}),
          });
        } catch (error) {
          if (!(error instanceof RebaseNeedsResolution)) throw error;
          await checkMcpAuthorization(payload, "pushdocs:submit");
          await repository.requireProjectAccess(userId, projectId, "branch:push");
          const current = await requireConflictReview(payload, provider, target);
          if (
            !sameBranchUpdatePolicy(
              review.details.branchUpdatePolicy,
              current.details.branchUpdatePolicy,
            ) ||
            current.branches.find((item) => item.name === branch)?.sha !==
              error.progress.parentSha ||
            current.branches.find((item) => item.name === sourceBranch)?.sha !==
              error.progress.sourceSha
          )
            throw new BranchMergeConflictError(
              "Ветки или политика изменились во время подготовки rebase. Начните обновление заново.",
            );
          const snapshot = error.snapshot;
          snapshot.updatePolicy = current.details.branchUpdatePolicy;
          await restrictConflictSnapshot(snapshot, target, provider);
          await repository.pauseRebaseUpdate(
            jobId,
            attempt,
            error.progress,
            snapshot,
            branchConflictRepositoryKey(target),
          );
          return false;
        }
        if (
          prepared.parentSha !== (saved?.parentSha ?? destination.sha) ||
          prepared.sourceSha !== (saved?.sourceSha ?? incoming.sha) ||
          (saved && prepared.sha !== saved.sha)
        )
          throw new BranchMergeConflictError(
            "Ветки изменились во время подготовки. Обновите данные из Git.",
          );
        await repository.savePreparedBranchUpdate(jobId, attempt, { ...prepared, targetKey });
        await repository.requireProjectAccess(userId, projectId, "branch:push");
        const currentTarget = await repository.getProjectSyncTarget(projectId);
        if (
          !currentTarget ||
          mergeTargetKey(currentTarget) !== targetKey ||
          branch === currentTarget.default_branch
        )
          throw new BranchMergeConflictError("Подключение или основная ветка проекта изменились.");
        const finalReview = await requireConflictReview(payload, provider, currentTarget);
        if (
          !sameBranchUpdatePolicy(
            review.details.branchUpdatePolicy,
            finalReview.details.branchUpdatePolicy,
          )
        )
          throw new BranchMergeConflictError(branchUpdateMessages.changed);
        const current = await provider.listBranches(target.provider_repository_id);
        const currentBranch = current.find((item) => item.name === branch);
        if (
          !currentBranch ||
          currentBranch.protected ||
          currentBranch.sha !== prepared.parentSha ||
          current.find((item) => item.name === sourceBranch)?.sha !== prepared.sourceSha
        )
          throw new BranchMergeConflictError(
            "Ветки обновились перед отправкой. Повторите обновление с актуальными данными.",
          );
        await checkMcpAuthorization(payload, "pushdocs:submit");
        if (prepared.sha !== prepared.parentSha) await transport.publish(prepared);
        await synchronize();
      },
    );
  }

  async function submitChangeSet(payload: unknown): Promise<void> {
    const target = await repository.getChangeSetSubmission(
      stringFromPayload(payload, "changeSetId"),
    );
    if (!target || target.project_id !== projectIdFromPayload(payload))
      throw new Error("Change set is unavailable");
    await repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${target.branch}`,
      () => submitLocked(payload),
    );
  }

  async function submitLocked(payload: unknown): Promise<void> {
    await checkMcpAuthorization(payload, "pushdocs:submit");
    const projectId = projectIdFromPayload(payload);
    const changeSetId = stringFromPayload(payload, "changeSetId");
    const message = stringFromPayload(payload, "message");
    const createReview = booleanFromPayload(payload, "createReview");
    const userId = stringFromPayload(payload, "userId");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    if (createReview)
      await repository.requireProjectAccess(userId, projectId, "change-request:create");
    if (!(await repository.getProjectSyncTarget(projectId)))
      throw new Error("Project sync target is unavailable or no longer granted");
    const target = await repository.getChangeSetSubmission(changeSetId);
    if (!target || target.project_id !== projectId) throw new Error("Change set is unavailable");
    const reviewTitle =
      optionalPayloadString(payload, "title") ??
      (message.split("\n", 1)[0] || "Обновление документации");
    const reviewTarget = optionalPayloadString(payload, "targetBranch") ?? target.default_branch;
    const description = optionalPayloadString(payload, "description");
    const needsReview = createReview && target.branch !== reviewTarget;
    const retryReview = async () => {
      if (
        description !== undefined ||
        optionalPayloadString(payload, "targetBranch") ||
        optionalPayloadString(payload, "oauthGrantId")
      )
        await repository.enqueueReviewCreation(projectId, target.branch, reviewTitle, userId, {
          targetBranch: reviewTarget,
          description,
          oauthGrantId: optionalPayloadString(payload, "oauthGrantId"),
        });
      else await repository.enqueueReviewCreation(projectId, target.branch, reviewTitle, userId);
    };
    if (target.status === "submitted") {
      if (needsReview) await retryReview();
      return;
    }
    if (target.status !== "submitting") throw new Error("Change set is not ready for submission");
    const { access, provider } = await providerAccessFor(target);
    const branches = await provider.listBranches(target.provider_repository_id);
    let current = branches.find((branch) => branch.name === target.branch);
    if (payload && typeof payload === "object" && "newBranch" in payload && payload.newBranch) {
      const baseSha = stringFromPayload(payload, "branchBaseSha");
      if (!current)
        current = await provider.createBranch(
          target.provider_repository_id,
          target.branch,
          baseSha,
        );
      else if (current.sha !== baseSha && !target.prepared_commit)
        throw new Error("Новая ветка уже содержит другие изменения. Отправка остановлена.");
    }
    if (!current) throw new Error(`Branch ${target.branch} was not found`);

    const parentSha = target.prepared_commit?.parentSha ?? current.sha;
    let binaryDeletes = target.files.filter(
      (file) => file.operation === "delete" && isMediaFile(file.path),
    );
    let textFiles = target.files.filter((file) => !binaryDeletes.includes(file));
    if (parentSha !== target.base_commit_sha) {
      const compared = await Promise.all(
        textFiles.map(async (file) => ({
          ...file,
          base_content: await loadTextOrNull(
            provider,
            target.provider_repository_id,
            target.base_commit_sha,
            repositoryPath(target.root_path, file.path),
          ),
          theirsContent: await loadTextOrNull(
            provider,
            target.provider_repository_id,
            parentSha,
            repositoryPath(target.root_path, file.path),
          ),
        })),
      );
      const conflicts: Parameters<WorkerRepository["markChangeSetConflicted"]>[3] = compared
        .filter(
          (file) =>
            file.theirsContent !== file.base_content && file.theirsContent !== file.ours_content,
        )
        .map((file) => ({
          baseContent: file.base_content,
          oursContent: file.ours_content,
          path: file.path,
          theirsContent: file.theirsContent,
        }));
      {
        const binaryFiles = [
          ...target.attachments,
          ...binaryDeletes.map((file) => ({ repository_path: file.path, storage_key: null })),
        ];
        const deletedUpstream = new Set<string>();
        for (const attachment of binaryFiles) {
          const filePath = repositoryPath(target.root_path, attachment.repository_path);
          const binaryHash = async (ref: string) => {
            try {
              return createHash("sha256")
                .update(await provider.readBinary(target.provider_repository_id, ref, filePath))
                .digest("hex");
            } catch (error) {
              if (error instanceof Error && /\b404\b/.test(error.message)) return null;
              throw error;
            }
          };
          const base = await binaryHash(target.base_commit_sha);
          const theirs = await binaryHash(parentSha);
          const ours =
            attachment.storage_key === null
              ? null
              : createHash("sha256")
                  .update(
                    await readStoredAttachment(path.join(attachmentsRoot, attachment.storage_key)),
                  )
                  .digest("hex");
          if (theirs !== base && theirs !== ours)
            conflicts.push({
              kind: "binary",
              path: attachment.repository_path,
              baseContent: base,
              oursContent: ours,
              theirsContent: theirs,
            });
          if (theirs === null) deletedUpstream.add(attachment.repository_path);
        }
        binaryDeletes = binaryDeletes.filter((file) => !deletedUpstream.has(file.path));
      }
      if (conflicts.length > 0) {
        await repository.markChangeSetConflicted(changeSetId, projectId, parentSha, conflicts);
        return;
      }
      textFiles = compared
        .filter((file) => file.ours_content !== file.theirsContent)
        .map((file) => ({
          ...file,
          operation:
            file.ours_content === null ? "delete" : file.theirsContent === null ? "add" : "modify",
        }));
    }

    const currentPaths =
      target.attachments.length > 0
        ? new Set(
            await provider.listFiles(
              target.provider_repository_id,
              target.prepared_commit?.parentSha ?? current.sha,
            ),
          )
        : new Set<string>();
    const attachmentChanges: ProviderFileChange[] = [];
    let submissionBytes = textFiles.reduce(
      (total, file) => total + Buffer.byteLength(file.ours_content ?? ""),
      0,
    );
    if (submissionBytes > 256 * 1024 * 1024) throw new Error("Change set exceeds 256 MiB");
    for (const attachment of target.attachments) {
      const destinationPath = repositoryPath(target.root_path, attachment.repository_path);
      const content = await readStoredAttachment(
        path.join(attachmentsRoot, attachment.storage_key),
      );
      if (content.byteLength > 64 * 1024 * 1024) throw new Error("Attachment exceeds 64 MiB");
      submissionBytes += content.byteLength;
      if (submissionBytes > 256 * 1024 * 1024) throw new Error("Change set exceeds 256 MiB");
      attachmentChanges.push({
        content,
        operation: currentPaths.has(destinationPath) ? "update" : "create",
        path: destinationPath,
      });
    }
    const changes: ProviderFileChange[] = [
      ...[...textFiles, ...binaryDeletes].map((file) => ({
        content: file.ours_content === null ? null : Buffer.from(file.ours_content, "utf8"),
        operation:
          file.operation === "add"
            ? ("create" as const)
            : file.operation === "delete"
              ? ("delete" as const)
              : ("update" as const),
        path: repositoryPath(target.root_path, file.path),
      })),
      ...attachmentChanges,
    ];
    const operationId =
      target.prepared_commit?.operationId ?? stringFromPayload(payload, "operationId");
    const createdAt = target.prepared_commit?.createdAt ?? stringFromPayload(payload, "createdAt");
    const transport = (options.createGitTransport ?? ((input) => new GitTransport(input)))(
      gitTransportOptions(target, operationId, access),
    );
    const prepared = await transport.prepare({
      branch: target.branch,
      changes,
      baseSha: target.prepared_commit?.parentSha ?? current.sha,
      operationId,
      createdAt,
      message,
    });
    await repository.savePreparedCommit(changeSetId, { ...prepared, operationId, createdAt });
    await checkMcpAuthorization(payload, "pushdocs:submit");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    if (!(await repository.getProjectSyncTarget(projectId)))
      throw new Error("Project connection grant was revoked");
    const published = await transport.publish(prepared);
    const commit = {
      sha: published.sha,
      url: `${target.clone_url.replace(/\.git$/, "")}/${target.kind === "gitlab" ? "-/" : ""}commit/${published.sha}`,
    };
    await repository.markChangeSetSubmitted({
      changeSetId,
      commitSha: commit.sha,
      commitUrl: commit.url,
      projectId,
    });
    try {
      if (needsReview) {
        const existing = (await provider.listChangeRequests(target.provider_repository_id)).find(
          (review) =>
            review.sourceBranch === target.branch &&
            (!optionalPayloadString(payload, "targetBranch") ||
              review.targetBranch === reviewTarget) &&
            review.state === "open",
        );
        if (!existing) {
          await checkMcpAuthorization(payload, "pushdocs:submit");
          await repository.requireProjectAccess(userId, projectId, "change-request:create");
          await provider.ensureChangeRequest({
            repositoryId: target.provider_repository_id,
            sourceBranch: target.branch,
            targetBranch: reviewTarget,
            title: reviewTitle,
            ...(description !== undefined ? { description } : {}),
          });
        }
      }
      await synchronizeReviews(projectId, provider, target.provider_repository_id);
    } catch (error) {
      logger.error(
        JSON.stringify({
          projectId,
          commitSha: commit.sha,
          error: String(error),
          stage: "review-after-push",
        }),
      );
      if (needsReview) await retryReview();
      else await repository.enqueueReviewsSync(projectId);
    }
  }

  async function runJob(): Promise<boolean> {
    const job = await repository.claimNextJob();
    if (!job) return false;
    return repository.withGitRefLock(`job:${job.id}`, async () => {
      if (!(await repository.heartbeatJob(job.id, job.attempts))) return true;
      return runClaimedJob(job);
    });
  }

  async function runClaimedJob(
    job: NonNullable<Awaited<ReturnType<WorkerRepository["claimNextJob"]>>>,
  ): Promise<boolean> {
    const heartbeat = setInterval(() => {
      void repository.heartbeatJob(job.id, job.attempts).catch((error: unknown) => {
        logger.error(`Job heartbeat failed: ${String(error)}`);
      });
    }, 30_000);
    try {
      if (job.kind === "project.sync") {
        await synchronizeProject(projectIdFromPayload(job.payload));
      } else if (job.kind === "reviews.sync") {
        const projectId = projectIdFromPayload(job.payload);
        const target = await repository.getProjectSyncTarget(projectId);
        if (!target) throw new Error("Подключение проекта недоступно");
        await synchronizeReviews(
          projectId,
          await providerFor(target),
          target.provider_repository_id,
        );
      } else if (job.kind === "branch.sync") {
        await synchronizeBranch(
          projectIdFromPayload(job.payload),
          stringFromPayload(job.payload, "branch"),
          undefined,
          (completed, total, receivedBytes) =>
            repository.updateJobProgress(
              job.id,
              job.attempts,
              "importing-documents",
              { completed, total },
              { receivedBytes, totalBytes: null },
            ),
        );
      } else if (job.kind === "branch.merge") {
        if ((job.payload as Record<string, unknown>).inspectionId) {
          await resolveBranchConflicts(
            job.payload as Record<string, unknown>,
            job.id,
            new Date(job.created_at).toISOString(),
            job.attempts,
          );
        } else {
          await mergeBranch(
            job.payload,
            job.id,
            new Date(job.created_at).toISOString(),
            job.attempts,
          );
        }
      } else if (job.kind === branchUpdateJobKind) {
        const finished = await updateReviewBranch(
          job.payload as Record<string, unknown>,
          job.id,
          new Date(job.created_at).toISOString(),
          job.attempts,
        );
        if (finished === false) return true;
      } else if (job.kind === "branch.conflicts") {
        await inspectBranchConflicts(job.payload, job.id, job.attempts);
      } else if (job.kind === "branch.create") {
        await createBranch(job.payload, (progress, counts) =>
          counts
            ? repository.updateJobProgress(job.id, job.attempts, progress, counts)
            : repository.updateJobProgress(job.id, job.attempts, progress),
        );
      } else if (job.kind === "review.create") {
        await checkMcpAuthorization(job.payload, "pushdocs:submit");
        const projectId = projectIdFromPayload(job.payload);
        await repository.requireProjectAccess(
          stringFromPayload(job.payload, "userId"),
          projectId,
          "change-request:create",
        );
        const target = await repository.getProjectSyncTarget(projectId);
        if (!target) throw new Error("Подключение проекта недоступно");
        const branch = stringFromPayload(job.payload, "branch");
        const reviewTarget =
          optionalPayloadString(job.payload, "targetBranch") ?? target.default_branch;
        if (branch === reviewTarget) throw new Error("Для PR / MR нужна отдельная ветка");
        const provider = await providerFor(target);
        const existing = (await provider.listChangeRequests(target.provider_repository_id)).find(
          (review) =>
            review.sourceBranch === branch &&
            review.targetBranch === reviewTarget &&
            review.state === "open",
        );
        if (!existing) {
          await checkMcpAuthorization(job.payload, "pushdocs:submit");
          await repository.requireProjectAccess(
            stringFromPayload(job.payload, "userId"),
            projectId,
            "change-request:create",
          );
          await provider.ensureChangeRequest({
            repositoryId: target.provider_repository_id,
            sourceBranch: branch,
            targetBranch: reviewTarget,
            title: stringFromPayload(job.payload, "title"),
            ...(optionalPayloadString(job.payload, "description") !== undefined
              ? { description: optionalPayloadString(job.payload, "description") }
              : {}),
          });
        }
        await synchronizeReviews(projectId, provider, target.provider_repository_id);
      } else if (job.kind === "change-set.submit") {
        await submitChangeSet(job.payload);
      } else {
        throw new Error(`Unsupported job kind: ${job.kind}`);
      }
      await repository.completeJob(job.id, job.attempts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (
        ((job.kind === "branch.merge" && (job.payload as Record<string, unknown>).inspectionId) ||
          job.kind === branchUpdateJobKind) &&
        (error instanceof BranchMergeConflictError ||
          (error instanceof BranchNotFoundError &&
            !(job.payload as Record<string, unknown>).preparedUpdate) ||
          (typeof error === "object" &&
            error !== null &&
            "code" in error &&
            ["PROVIDER_CONFLICT", "ACCESS_DENIED"].includes(String(error.code))))
      )
        await repository.releaseBranchMergeReservation(job.id, job.attempts);
      const projectId = projectIdFromPayload(job.payload);
      const permanentSubmissionFailure =
        job.kind === "change-set.submit" && error instanceof CloneOriginMismatchError;
      const mcpAuthorizationFailure =
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        error.code === "PERMISSION_DENIED";
      const permanentBranchFailure =
        mcpAuthorizationFailure ||
        error instanceof BranchNotFoundError ||
        error instanceof BranchMergeConflictError ||
        (["branch.merge", branchUpdateJobKind].includes(job.kind) &&
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          ["ACCESS_DENIED", "PROVIDER_CONFLICT", "PERMISSION_DENIED"].includes(
            String(error.code),
          )) ||
        (job.kind === "branch.create" &&
          (/^(Исходная ветка обновилась|Ветка .+ уже существует)/.test(message) ||
            (typeof error === "object" &&
              error !== null &&
              "code" in error &&
              error.code === "ACCESS_DENIED")));
      if (
        job.kind === "change-set.submit" &&
        error &&
        typeof error === "object" &&
        "code" in error &&
        error.code === "PROVIDER_CONFLICT"
      ) {
        const changeSetId = stringFromPayload(job.payload, "changeSetId");
        await repository.discardRejectedCommit(changeSetId, projectId);
        await repository.releaseChangeSetSubmission(changeSetId, projectId, message);
        await repository.failJob(job.id, message, false, job.attempts);
        return true;
      }
      const retryBase = (job.payload as { retryBaseAttempt?: number }).retryBaseAttempt;
      const failures =
        job.kind === branchUpdateJobKind && typeof retryBase === "number"
          ? Math.max(1, job.attempts - retryBase)
          : job.attempts;
      const retryAllowed = failures < 5;
      if (!retryAllowed || permanentSubmissionFailure) {
        await repository.markProjectAttention(projectId);
        if (job.kind === "change-set.submit") {
          await repository.releaseChangeSetSubmission(
            stringFromPayload(job.payload, "changeSetId"),
            projectId,
            message,
          );
        }
      }
      await repository.failJob(
        job.id,
        message,
        !permanentBranchFailure && !permanentSubmissionFailure && retryAllowed,
        job.attempts,
      );
      logger.error(JSON.stringify({ error: message, jobId: job.id, kind: job.kind }));
    } finally {
      clearInterval(heartbeat);
    }
    return true;
  }

  async function synchronizeActiveReviews(): Promise<void> {
    for (const projectId of await repository.listActiveProjectIds()) {
      try {
        const target = await repository.getProjectSyncTarget(projectId);
        if (!target) continue;
        const provider = await providerFor(target);
        await synchronizeReviews(projectId, provider, target.provider_repository_id);
      } catch (error) {
        logger.error(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
            projectId,
            task: "reviews.poll",
          }),
        );
      }
    }
  }

  return {
    runJob,
    submitChangeSet,
    synchronizeActiveReviews,
    synchronizeBranch,
    synchronizeProject,
    synchronizeReviews,
  };
}
