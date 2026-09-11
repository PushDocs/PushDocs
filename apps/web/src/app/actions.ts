"use server";

import { createHash, randomBytes } from "node:crypto";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  acceptInvitationSchema,
  bootstrapSchema,
  createCommentSchema,
  createComponentSchema,
  createConnectionSchema,
  createDocumentSchema,
  createProjectSchema,
  deleteConnectionSchema,
  deleteProjectSchema,
  inviteMemberSchema,
  loginSchema,
  resolveConflictSchema,
  saveDraftSchema,
  submitChangeSetSchema,
  updateConnectionSchema,
  updateProjectSchema,
} from "@pushdocs/contracts";
import {
  createOpaqueToken,
  encryptSecret,
  hashInvitationToken,
  hashOpaqueToken,
  RevisionConflictError,
} from "@pushdocs/db";
import { normalizeRepositoryLocator } from "@pushdocs/providers";
import { clearVpnAccess, validateVpnProfile, vpnProfileLimit } from "@pushdocs/vpn";
import argon2 from "argon2";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { providerForConnection } from "@/lib/provider";
import {
  actor,
  application,
  optionalUser,
  repository,
  requireOperator,
  requireUser,
  sessionCookieName,
} from "@/lib/server";

async function uploadedVpnProfile(formData: FormData): Promise<string | undefined> {
  const value = formData.get("vpnProfile");
  if (!(value instanceof File) || value.size === 0) return undefined;
  if (value.size > vpnProfileLimit || !value.name.toLowerCase().endsWith(".ovpn"))
    throw new Error("VPN_PROFILE_INVALID_FILE");
  return validateVpnProfile(await value.text());
}

async function createBrowserSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await repository().createSession(userId, hashOpaqueToken(token), expiresAt);
  (await cookies()).set(sessionCookieName, token, {
    expires: expiresAt,
    httpOnly: true,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function bootstrapAction(formData: FormData): Promise<void> {
  if (await optionalUser()) redirect("/projects");
  const input = bootstrapSchema.parse(Object.fromEntries(formData));
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  const user = await repository().createOperator({ ...input, passwordHash });
  await createBrowserSession(user.id);
  redirect("/projects");
}

export async function loginAction(formData: FormData): Promise<void> {
  const input = loginSchema.parse(Object.fromEntries(formData));
  const user = await repository().findUserByEmail(input.email);
  if (!user || !(await argon2.verify(user.password_hash, input.password))) {
    redirect("/login?error=credentials");
  }
  await createBrowserSession(user.id);
  redirect("/projects");
}

export async function logoutAction(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(sessionCookieName)?.value;
  if (token) await repository().deleteSession(hashOpaqueToken(token));
  cookieStore.delete(sessionCookieName);
  redirect("/login");
}

export async function createConnectionAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const input = createConnectionSchema.parse(Object.fromEntries(formData));
  const vpnProfile = await uploadedVpnProfile(formData);
  if (vpnProfile && (input.kind !== "gitlab" || new URL(input.baseUrl).protocol !== "https:"))
    throw new Error("VPN_REQUIRES_HTTPS_GITLAB");
  await application().createConnection(actor(user), {
    baseUrl: input.baseUrl,
    kind: input.kind,
    name: input.name,
    secretEncrypted: encryptSecret(input.token),
    ...(vpnProfile ? { vpnProfileEncrypted: encryptSecret(vpnProfile) } : {}),
  });
  revalidatePath("/settings/connections");
  const projectId = formData.get("projectId");
  if (typeof projectId === "string" && projectId)
    revalidatePath(`/projects/${projectId}/settings/connections`);
}

export async function updateConnectionAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const input = updateConnectionSchema.parse(Object.fromEntries(formData));
  const current = await repository().getConnection(input.connectionId);
  if (!current) throw new Error("CONNECTION_NOT_FOUND");
  const vpnProfile = await uploadedVpnProfile(formData);
  if (vpnProfile && (current.kind !== "gitlab" || new URL(input.baseUrl).protocol !== "https:"))
    throw new Error("VPN_REQUIRES_HTTPS_GITLAB");
  const removeVpn = formData.get("removeVpn") === "on";
  if (vpnProfile && removeVpn) throw new Error("VPN_PROFILE_CHANGE_CONFLICT");
  const repositoryIds = await repository().listConnectionRepositories(input.connectionId);
  const vpnChanged = Boolean(vpnProfile) || removeVpn;
  const credentialsChanged =
    Boolean(input.token) || input.baseUrl !== current.base_url || vpnChanged;
  if (input.baseUrl !== current.base_url && repositoryIds.length > 0)
    throw new Error("CONNECTION_BASE_URL_IN_USE");
  if (credentialsChanged && !vpnChanged) {
    const provider = await providerForConnection({
      ...current,
      base_url: input.baseUrl,
      connection_id: current.id,
      secret_encrypted: input.token ? encryptSecret(input.token) : current.secret_encrypted,
    });
    for (const repositoryId of repositoryIds) await provider.listBranches(repositoryId);
  }
  if (removeVpn) await clearVpnAccess(current.vpn_slot).catch(() => undefined);
  await application().updateConnection(actor(user), {
    baseUrl: input.baseUrl,
    connectionId: input.connectionId,
    name: input.name,
    ...(input.token ? { secretEncrypted: encryptSecret(input.token) } : {}),
    ...(vpnProfile
      ? { vpnProfileEncrypted: encryptSecret(vpnProfile) }
      : removeVpn
        ? { vpnProfileEncrypted: null }
        : {}),
  });
  if (credentialsChanged)
    for (const project of await repository().listConnectionProjects(input.connectionId))
      await repository().enqueueBranchSync(project.id, project.default_branch);
  revalidatePath("/settings/connections");
  revalidatePath("/projects");
  const projectId = formData.get("projectId");
  if (typeof projectId === "string" && projectId)
    revalidatePath(`/projects/${projectId}/settings/connections`);
}

function connectionSettingsError(error: unknown): string {
  if (!(error instanceof Error)) return "Не удалось сохранить настройки. Повторите попытку.";
  switch (error.message) {
    case "CONNECTION_BASE_URL_IN_USE":
      return "Адрес нельзя изменить, пока подключение используется проектами.";
    case "CONNECTION_NOT_FOUND":
      return "Подключение не найдено. Обновите страницу.";
    case "VPN_PROFILE_INVALID_FILE":
      return "Выберите корректный файл OpenVPN в формате .ovpn.";
    case "VPN_PROFILE_CHANGE_CONFLICT":
      return "Нельзя одновременно заменить и отключить VPN-профиль.";
    default:
      return "Не удалось сохранить настройки. Проверьте данные и повторите попытку.";
  }
}

export async function saveConnectionSettingsAction(
  formData: FormData,
): Promise<{ ok: boolean; message: string }> {
  try {
    await updateConnectionAction(formData);
    return { ok: true, message: "Настройки подключения сохранены" };
  } catch (error) {
    return { ok: false, message: connectionSettingsError(error) };
  }
}

export async function deleteConnectionAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const input = deleteConnectionSchema.parse(Object.fromEntries(formData));
  const current = await repository().getConnection(input.connectionId);
  if (!current) throw new Error("CONNECTION_NOT_FOUND");
  if (input.confirmation !== current.name) throw new Error("CONFIRMATION_MISMATCH");
  await clearVpnAccess(current.vpn_slot).catch(() => undefined);
  await application().deleteConnection(actor(user), input.connectionId);
  revalidatePath("/settings/connections");
  revalidatePath("/projects");
  redirect("/settings/connections");
}

export async function createProjectAction(formData: FormData): Promise<void> {
  const user = await requireOperator();
  const input = createProjectSchema.parse(Object.fromEntries(formData));
  const connection = await repository().getConnection(input.connectionId);
  if (!connection) throw new Error("CONNECTION_NOT_FOUND");
  const provider = await providerForConnection({ ...connection, connection_id: connection.id });
  const remote = await provider.getRepository(
    normalizeRepositoryLocator(connection.kind, input.repositoryProviderId),
  );
  const defaultBranch = input.defaultBranch || remote.defaultBranch;
  const branches = await provider.listBranches(remote.id);
  if (!branches.some((branch) => branch.name === defaultBranch))
    throw new Error("DEFAULT_BRANCH_NOT_FOUND");
  const created = (await application().createProject(actor(user), {
    ...input,
    defaultBranch,
    repositoryFullName: remote.fullName,
    repositoryProviderId: remote.id,
    repositoryUrl: remote.cloneUrl,
  })) as { id: string };
  redirect(`/projects/${created.id}/documents`);
}

export async function updateProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = updateProjectSchema.parse(Object.fromEntries(formData));
  await repository().requireProjectAccess(user.id, input.projectId, "project:configure");
  const current = await repository().getProjectSettings(input.projectId);
  if (!current) throw new Error("PROJECT_NOT_FOUND");
  if (current.default_branch !== input.defaultBranch) {
    const target = await repository().getProjectSyncTarget(input.projectId);
    if (!target) throw new Error("PROJECT_CONNECTION_NOT_FOUND");
    const provider = await providerForConnection(target);
    const branches = await provider.listBranches(target.provider_repository_id);
    if (!branches.some((branch) => branch.name === input.defaultBranch))
      throw new Error("DEFAULT_BRANCH_NOT_FOUND");
  }
  const needsSync =
    current.default_branch !== input.defaultBranch || current.root_path !== input.rootPath;
  await application().updateProject(actor(user), input);
  if (needsSync) await repository().enqueueBranchSync(input.projectId, input.defaultBranch);
  revalidatePath("/projects");
  revalidatePath(`/projects/${input.projectId}/settings`);
  revalidatePath(`/projects/${input.projectId}/documents`);
}

export async function deleteProjectAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = deleteProjectSchema.parse(Object.fromEntries(formData));
  await repository().requireProjectAccess(user.id, input.projectId, "project:configure");
  const current = await repository().getProjectSettings(input.projectId);
  if (!current) throw new Error("PROJECT_NOT_FOUND");
  if (input.confirmation !== current.slug) throw new Error("CONFIRMATION_MISMATCH");
  await application().deleteProject(actor(user), input.projectId);
  const attachmentsRoot = path.resolve(
    /* turbopackIgnore: true */
    process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "./data/attachments",
  );
  await rm(path.join(attachmentsRoot, input.projectId), { force: true, recursive: true });
  revalidatePath("/projects");
  redirect("/projects");
}

export async function saveDraftAction(
  formData: FormData,
): Promise<{ error?: "conflict"; revision?: number }> {
  const user = await requireUser();
  const input = saveDraftSchema.parse({
    ...Object.fromEntries(formData),
    expectedRevision: Number(formData.get("expectedRevision")),
  });
  const projectId = String(formData.get("projectId"));
  try {
    const result = await application().saveDraft(actor(user), { ...input, projectId });
    revalidatePath(`/projects/${projectId}/documents`);
    return { revision: result.revision };
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return { error: "conflict" };
    }
    throw error;
  }
}

export async function createCommentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = createCommentSchema.parse(Object.fromEntries(formData));
  const projectId = String(formData.get("projectId"));
  await application().createComment(actor(user), { ...input, projectId });
  revalidatePath(`/projects/${projectId}/documents`);
}

export async function inviteMemberAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = inviteMemberSchema.parse(Object.fromEntries(formData));
  const projectId = String(formData.get("projectId"));
  const invitation = createOpaqueToken();
  await application().inviteMember(actor(user), {
    ...input,
    projectId,
    tokenHash: invitation.hash,
  });
  redirect(
    `/projects/${projectId}/settings/members?invitation=${encodeURIComponent(invitation.token)}`,
  );
}

export async function acceptInvitationAction(formData: FormData): Promise<void> {
  const input = acceptInvitationSchema.parse(Object.fromEntries(formData));
  const tokenHash = hashInvitationToken(input.token);
  const invitation = await repository().getInvitation(tokenHash);
  if (!invitation) redirect("/login?error=invitation");
  const current = await optionalUser();
  let userId: string;
  if (current) {
    if (current.email !== invitation.email) redirect("/login?error=invitation-account");
    userId = current.id;
  } else {
    const existing = await repository().findUserByEmail(invitation.email);
    if (existing) {
      if (!(await argon2.verify(existing.password_hash, input.password))) {
        redirect(`/invite/${encodeURIComponent(input.token)}?error=credentials`);
      }
      userId = existing.id;
    } else {
      const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
      const created = await repository().createUser({
        displayName: input.displayName,
        email: invitation.email,
        passwordHash,
      });
      userId = created.id;
    }
  }
  const accepted = await repository().acceptInvitation(tokenHash, userId);
  if (!current) await createBrowserSession(userId);
  redirect(`/projects/${accepted.projectId}/documents`);
}

export async function uploadAttachmentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId"));
  const branch = String(formData.get("branch"));
  await repository().requireProjectAccess(user.id, projectId, "document:write");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error("FILE_REQUIRED");
  if (file.size > 10 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
  const allowed = new Set([
    "image/avif",
    "image/gif",
    "image/jpeg",
    "image/png",
    "image/svg+xml",
    "image/webp",
    "application/pdf",
  ]);
  if (!allowed.has(file.type)) throw new Error("FILE_TYPE_NOT_ALLOWED");
  const contents = Buffer.from(await file.arrayBuffer());
  const sha256 = createHash("sha256").update(contents).digest("hex");
  const extension = path
    .extname(file.name)
    .toLowerCase()
    .replace(/[^.a-z0-9]/g, "");
  const safeName = path
    .basename(file.name, path.extname(file.name))
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  const repositoryPath = `static/img/${sha256.slice(0, 10)}-${safeName || "asset"}${extension}`;
  const storageKey = `${projectId}/${randomBytes(16).toString("hex")}${extension}`;
  const attachmentsRoot = path.resolve(
    /* turbopackIgnore: true */
    process.env.PUSHDOCS_ATTACHMENTS_DIR ?? "./data/attachments",
  );
  const destination = path.join(attachmentsRoot, storageKey);
  const temporary = `${destination}.uploading`;
  await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
  await writeFile(temporary, contents, { flag: "wx", mode: 0o600 });
  await rename(temporary, destination);
  await repository().recordAttachment({
    branch,
    mediaType: file.type,
    originalName: path.basename(file.name),
    projectId,
    repositoryPath,
    sha256,
    sizeBytes: file.size,
    storageKey,
  });
  revalidatePath(`/projects/${projectId}/files`);
}

export async function synchronizeBranchAction(formData: FormData): Promise<string> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId"));
  const branch = String(formData.get("branch"));
  await repository().requireProjectAccess(user.id, projectId, "project:read");
  const jobId = await repository().enqueueBranchSync(projectId, branch);
  revalidatePath(`/projects/${projectId}/documents`);
  return jobId;
}

export async function submitChangeSetAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = submitChangeSetSchema.parse({
    ...Object.fromEntries(formData),
    createReview: formData.get("createReview") === "on",
    newBranch: String(formData.get("newBranch") ?? "").trim() || undefined,
  });
  await repository().requireProjectAccess(user.id, input.projectId, "branch:push");
  await repository().queueChangeSetSubmission({ ...input, userId: user.id });
  revalidatePath(`/projects/${input.projectId}/changes`);
  if (input.newBranch)
    redirect(
      `/projects/${input.projectId}/changes?${new URLSearchParams({ branch: input.newBranch })}`,
    );
}

export async function resolveConflictAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const input = resolveConflictSchema.parse(Object.fromEntries(formData));
  await repository().requireProjectAccess(user.id, input.projectId, "document:write");
  await repository().resolveConflict(input);
  revalidatePath(`/projects/${input.projectId}/changes`);
}

export async function retryChangeSetSubmissionAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId"));
  const changeSetId = String(formData.get("changeSetId"));
  await repository().retryChangeSetSubmission(changeSetId, projectId, user.id);
  revalidatePath(`/projects/${projectId}/changes`);
}

export async function createProjectComponentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId"));
  const input = createComponentSchema.parse(Object.fromEntries(formData));
  await repository().requireProjectAccess(user.id, projectId, "project:configure");
  await repository().createProjectComponent({ ...input, projectId });
  revalidatePath(`/projects/${projectId}/settings`);
  revalidatePath(`/projects/${projectId}/documents`);
}

export async function createDocumentAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const projectId = String(formData.get("projectId"));
  const input = createDocumentSchema.parse(Object.fromEntries(formData));
  await repository().requireProjectAccess(user.id, projectId, "document:write");
  const content = `---\ntitle: ${JSON.stringify(input.title)}\n---\n\n# ${input.title}\n`;
  await repository().createDraftDocument({ ...input, content, projectId, userId: user.id });
  redirect(
    `/projects/${projectId}/documents?branch=${encodeURIComponent(input.branch)}&path=${encodeURIComponent(input.path)}`,
  );
}

export async function startGitOperationAction(input: {
  projectId: string;
  branch: string;
  title?: string;
}) {
  const user = await requireUser();
  const store = repository();
  await store.requireProjectAccess(
    user.id,
    input.projectId,
    input.title ? "branch:push" : "project:read",
  );
  if (input.title)
    return store.enqueueReviewCreation(
      input.projectId,
      input.branch,
      input.title.trim().slice(0, 255),
      user.id,
    );
  return store.enqueueBranchSync(input.projectId, input.branch);
}

export async function gitOperationStatusAction(projectId: string, jobId: string) {
  const user = await requireUser();
  await repository().requireProjectAccess(user.id, projectId, "project:read");
  const job = await repository().getProjectJob(projectId, jobId);
  if (!job) throw new Error("Операция не найдена");
  return job;
}
