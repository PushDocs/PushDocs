import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  analyzeDocusaurusFiles,
  isEditableFile,
  isMediaFile,
  parseProjectConfig,
} from "@pushdocs/content";
import { decryptSecret, type PushDocsRepository } from "@pushdocs/db";
import { createProvider, type GitProvider, type ProviderFileChange } from "@pushdocs/providers";
import { prepareVpnAccess, type VpnAccess, type VpnConnection } from "@pushdocs/vpn";
import { GitTransport, type GitTransportOptions } from "./git-transport";

export type WorkerRepository = Pick<
  PushDocsRepository,
  | "claimNextJob"
  | "heartbeatJob"
  | "completeJob"
  | "ensureBranches"
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
  | "savePreparedCommit"
  | "withGitRefLock"
  | "discardRejectedCommit"
>;

interface ProviderInput {
  baseUrl: string;
  kind: "github" | "gitlab";
  request?: VpnAccess["fetch"];
  token: string;
}

export interface WorkerServiceOptions {
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
    if (error instanceof Error && /\b404\b/.test(error.message)) return null;
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
      : { fetch: (input: string | URL, init?: RequestInit) => fetch(input, init) };
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
    const requests = await provider.listChangeRequests(providerRepositoryId);
    const rows = await Promise.all(
      requests.map(async (request) => ({
        checks: await provider.listChecks(providerRepositoryId, request.headSha),
        externalId: request.id,
        headSha: request.headSha,
        sourceBranch: request.sourceBranch,
        state: request.state,
        targetBranch: request.targetBranch,
        title: request.title,
        url: request.url,
      })),
    );
    await repository.replaceChangeRequests(projectId, rows);
  }

  async function synchronizeBranch(
    projectId: string,
    branchName: string,
    provider?: GitProvider,
  ): Promise<void> {
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Project sync target is unavailable or no longer granted");
    await repository.withGitRefLock(
      `${target.base_url}:${target.provider_repository_id}:${branchName}`,
      () => synchronizeBranchLocked(projectId, branchName, provider),
    );
  }

  async function synchronizeBranchLocked(
    projectId: string,
    branchName: string,
    provider?: GitProvider,
  ): Promise<void> {
    const target = await repository.getProjectSyncTarget(projectId);
    if (!target) throw new Error("Project sync target is unavailable or no longer granted");
    const client = provider ?? (await providerFor(target));
    const branches = await client.listBranches(target.provider_repository_id);
    await repository.ensureBranches(projectId, branches);
    const branch = branches.find((item) => item.name === branchName);
    if (!branch) throw new Error(`Branch ${branchName} was not found`);
    const allPaths = await client.listFiles(target.provider_repository_id, branch.sha);
    const configPath = repositoryPath(target.root_path, ".pushdocs/config.json");
    const config = parseProjectConfig(
      allPaths.includes(configPath)
        ? await client.readFile(target.provider_repository_id, branch.sha, configPath)
        : null,
    );
    const prefix = target.root_path === "." ? "" : `${target.root_path.replace(/\/$/, "")}/`;
    const paths = allPaths.filter(
      (filePath) =>
        filePath.startsWith(prefix) && isEditableFile(config, filePath.slice(prefix.length)),
    );
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
      for (const [filePath, content] of loaded) contents.set(filePath, content);
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
    await repository.ensureProjectComponents(projectId, profile.unknownComponents);
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
    const projectId = projectIdFromPayload(payload);
    const changeSetId = stringFromPayload(payload, "changeSetId");
    const message = stringFromPayload(payload, "message");
    const createReview = booleanFromPayload(payload, "createReview");
    const userId = stringFromPayload(payload, "userId");
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    if (!(await repository.getProjectSyncTarget(projectId)))
      throw new Error("Project sync target is unavailable or no longer granted");
    const target = await repository.getChangeSetSubmission(changeSetId);
    if (!target || target.project_id !== projectId) throw new Error("Change set is unavailable");
    if (target.status === "submitted") return;
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
    const token = decrypt(target.secret_encrypted);
    if (new URL(target.clone_url).origin !== new URL(target.base_url).origin)
      throw new Error("Clone origin does not match the provider connection");
    const transport = (options.createGitTransport ?? ((input) => new GitTransport(input)))({
      directory: path.join(
        path.resolve(options.gitRoot ?? process.env.PUSHDOCS_GIT_CACHE_DIR ?? "./data/git"),
        createHash("sha256").update(operationId).digest("hex"),
      ),
      remote: target.clone_url,
      authorization: `Authorization: Basic ${Buffer.from(`${target.kind === "gitlab" ? "oauth2" : "x-access-token"}:${token}`).toString("base64")}`,
      proxyUrl: access.gitProxyUrl,
    });
    const prepared = await transport.prepare({
      branch: target.branch,
      changes,
      baseSha: target.prepared_commit?.parentSha ?? current.sha,
      operationId,
      createdAt,
      message,
    });
    await repository.savePreparedCommit(changeSetId, { ...prepared, operationId, createdAt });
    await repository.requireProjectAccess(userId, projectId, "branch:push");
    if (!(await repository.getProjectSyncTarget(projectId)))
      throw new Error("Project connection grant was revoked");
    const published = await transport.publish(prepared);
    const commit = {
      sha: published.sha,
      url: `${target.clone_url.replace(/\.git$/, "")}/${target.kind === "gitlab" ? "-/" : ""}commit/${published.sha}`,
    };
    if (createReview && target.branch !== target.default_branch) {
      const existing = (await provider.listChangeRequests(target.provider_repository_id)).find(
        (review) => review.sourceBranch === target.branch && review.state === "open",
      );
      if (!existing)
        await provider.ensureChangeRequest({
          repositoryId: target.provider_repository_id,
          sourceBranch: target.branch,
          targetBranch: target.default_branch,
          title: message.split("\n", 1)[0] || "Обновление документации",
        });
    }
    await repository.markChangeSetSubmitted({
      changeSetId,
      commitSha: commit.sha,
      commitUrl: commit.url,
      projectId,
    });
    await synchronizeReviews(projectId, provider, target.provider_repository_id);
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
      } else if (job.kind === "branch.sync") {
        await synchronizeBranch(
          projectIdFromPayload(job.payload),
          stringFromPayload(job.payload, "branch"),
        );
      } else if (job.kind === "review.create") {
        const projectId = projectIdFromPayload(job.payload);
        await repository.requireProjectAccess(
          stringFromPayload(job.payload, "userId"),
          projectId,
          "branch:push",
        );
        const target = await repository.getProjectSyncTarget(projectId);
        if (!target) throw new Error("Подключение проекта недоступно");
        const branch = stringFromPayload(job.payload, "branch");
        if (branch === target.default_branch) throw new Error("Для PR / MR нужна отдельная ветка");
        const provider = await providerFor(target);
        const existing = (await provider.listChangeRequests(target.provider_repository_id)).find(
          (review) => review.sourceBranch === branch && review.state === "open",
        );
        if (!existing)
          await provider.ensureChangeRequest({
            repositoryId: target.provider_repository_id,
            sourceBranch: branch,
            targetBranch: target.default_branch,
            title: stringFromPayload(job.payload, "title"),
          });
        await synchronizeReviews(projectId, provider, target.provider_repository_id);
      } else if (job.kind === "change-set.submit") {
        await submitChangeSet(job.payload);
      } else {
        throw new Error(`Unsupported job kind: ${job.kind}`);
      }
      await repository.completeJob(job.id, job.attempts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const projectId = projectIdFromPayload(job.payload);
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
      if (job.attempts >= 5) {
        await repository.markProjectAttention(projectId);
        if (job.kind === "change-set.submit") {
          await repository.releaseChangeSetSubmission(
            stringFromPayload(job.payload, "changeSetId"),
            projectId,
            message,
          );
        }
      }
      await repository.failJob(job.id, message, job.attempts < 5, job.attempts);
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
