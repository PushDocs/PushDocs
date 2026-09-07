import { readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeDocusaurusFiles } from "@pushdocs/content";
import { closeDatabase, decryptSecret, getDatabase, PushDocsRepository } from "@pushdocs/db";
import { createProvider, type GitProvider, ProviderConflictError } from "@pushdocs/providers";

const repository = new PushDocsRepository(getDatabase());
let stopping = false;
let nextReviewSyncAt = 0;

function projectIdFromPayload(payload: unknown): string {
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

function stringFromPayload(payload: unknown, key: string): string {
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

function booleanFromPayload(payload: unknown, key: string): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  return (payload as Record<string, unknown>)[key] === true;
}

function repositoryPath(rootPath: string, relativePath: string): string {
  const root = rootPath === "." ? "" : rootPath.replace(/^\/+|\/+$/g, "");
  return root ? `${root}/${relativePath}` : relativePath;
}

async function loadTextOrNull(
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
  const client =
    provider ??
    createProvider({
      baseUrl: target.base_url,
      kind: target.kind,
      token: decryptSecret(target.secret_encrypted),
    });
  const branches = await client.listBranches(target.provider_repository_id);
  const branch = branches.find((item) => item.name === branchName);
  if (!branch) throw new Error(`Branch ${branchName} was not found`);
  const allPaths = await client.listFiles(target.provider_repository_id, branch.name);
  const paths = allPaths.filter((filePath) => /\.(md|mdx)$/i.test(filePath));
  const contents = new Map<string, string>();
  for (let offset = 0; offset < paths.length; offset += 12) {
    const batch = paths.slice(offset, offset + 12);
    const loaded = await Promise.all(
      batch.map(
        async (filePath) =>
          [
            filePath,
            await client.readFile(target.provider_repository_id, branch.name, filePath),
          ] as const,
      ),
    );
    for (const [filePath, content] of loaded) contents.set(filePath, content);
  }
  const profile = analyzeDocusaurusFiles(contents, target.root_path);
  await repository.replaceImportedDocuments(projectId, branch.name, branch.sha, profile.documents);
  await repository.ensureProjectComponents(projectId, profile.unknownComponents);
}

async function synchronizeProject(projectId: string): Promise<void> {
  const target = await repository.getProjectSyncTarget(projectId);
  if (!target) throw new Error("Project sync target is unavailable or no longer granted");
  const provider = createProvider({
    baseUrl: target.base_url,
    kind: target.kind,
    token: decryptSecret(target.secret_encrypted),
  });
  const branches = await provider.listBranches(target.provider_repository_id);
  await repository.ensureBranches(projectId, branches);
  await synchronizeBranch(projectId, target.default_branch, provider);
  await synchronizeReviews(projectId, provider, target.provider_repository_id);
}

async function submitChangeSet(payload: unknown): Promise<void> {
  const projectId = projectIdFromPayload(payload);
  const changeSetId = stringFromPayload(payload, "changeSetId");
  const message = stringFromPayload(payload, "message");
  const createReview = booleanFromPayload(payload, "createReview");
  const target = await repository.getChangeSetSubmission(changeSetId);
  if (!target || target.project_id !== projectId) throw new Error("Change set is unavailable");
  if (target.status !== "submitting") throw new Error("Change set is not ready for submission");
  const provider = createProvider({
    baseUrl: target.base_url,
    kind: target.kind,
    token: decryptSecret(target.secret_encrypted),
  });
  const branches = await provider.listBranches(target.provider_repository_id);
  const current = branches.find((branch) => branch.name === target.branch);
  if (!current) throw new Error(`Branch ${target.branch} was not found`);

  if (current.sha !== target.base_commit_sha) {
    const compared = await Promise.all(
      target.files.map(async (file) => ({
        ...file,
        theirsContent: await loadTextOrNull(
          provider,
          target.provider_repository_id,
          current.sha,
          repositoryPath(target.root_path, file.path),
        ),
      })),
    );
    const conflicts = compared
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
    if (conflicts.length > 0) {
      await repository.markChangeSetConflicted(changeSetId, projectId, current.sha, conflicts);
      return;
    }
  }

  const attachmentsRoot = path.resolve(
    process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "./data/attachments",
  );
  const currentPaths =
    target.attachments.length > 0
      ? new Set(await provider.listFiles(target.provider_repository_id, current.sha))
      : new Set<string>();
  const attachmentChanges = await Promise.all(
    target.attachments.map(async (attachment) => {
      const destinationPath = repositoryPath(target.root_path, attachment.repository_path);
      return {
        content: await readFile(path.join(attachmentsRoot, attachment.storage_key)),
        operation: currentPaths.has(destinationPath) ? ("update" as const) : ("create" as const),
        path: destinationPath,
      };
    }),
  );
  let commit: { sha: string; url: string };
  try {
    commit = await provider.commitFiles({
      branch: target.branch,
      changes: [
        ...target.files.map((file) => ({
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
      ],
      expectedHeadSha: current.sha,
      message,
      repositoryId: target.provider_repository_id,
    });
  } catch (error) {
    if (error instanceof ProviderConflictError) {
      throw error;
    }
    throw error;
  }
  if (createReview && target.branch !== target.default_branch) {
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
  try {
    if (job.kind === "project.sync") {
      await synchronizeProject(projectIdFromPayload(job.payload));
    } else if (job.kind === "branch.sync") {
      await synchronizeBranch(
        projectIdFromPayload(job.payload),
        stringFromPayload(job.payload, "branch"),
      );
    } else if (job.kind === "change-set.submit") {
      await submitChangeSet(job.payload);
    } else {
      throw new Error(`Unsupported job kind: ${job.kind}`);
    }
    await repository.completeJob(job.id);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const projectId = projectIdFromPayload(job.payload);
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
    await repository.failJob(job.id, message, job.attempts < 5);
    console.error(JSON.stringify({ error: message, jobId: job.id, kind: job.kind }));
  }
  return true;
}

async function main(): Promise<void> {
  console.log("PushDocs worker started");
  while (!stopping) {
    const worked = await runJob();
    if (Date.now() >= nextReviewSyncAt) {
      nextReviewSyncAt = Date.now() + 30_000;
      for (const projectId of await repository.listActiveProjectIds()) {
        try {
          const target = await repository.getProjectSyncTarget(projectId);
          if (!target) continue;
          const provider = createProvider({
            baseUrl: target.base_url,
            kind: target.kind,
            token: decryptSecret(target.secret_encrypted),
          });
          await synchronizeReviews(projectId, provider, target.provider_repository_id);
        } catch (error) {
          console.error(
            JSON.stringify({
              error: error instanceof Error ? error.message : String(error),
              projectId,
              task: "reviews.poll",
            }),
          );
        }
      }
    }
    if (!worked) await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    stopping = true;
  });
}

try {
  await main();
} finally {
  await closeDatabase();
}
