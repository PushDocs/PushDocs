import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  const user = {
    displayName: "Admin",
    email: "admin@example.test",
    id: "user",
    isInstanceOperator: true,
  };
  return {
    actor: vi.fn((value: typeof user) => ({
      id: value.id,
      isInstanceOperator: value.isInstanceOperator,
    })),
    app: {
      createComment: vi.fn(),
      createConnection: vi.fn(),
      createProject: vi.fn(),
      deleteConnection: vi.fn(),
      deleteProject: vi.fn(),
      inviteMember: vi.fn(),
      saveDraft: vi.fn(),
      updateConnection: vi.fn(),
      updateProject: vi.fn(),
    },
    argonHash: vi.fn(),
    argonVerify: vi.fn(),
    cookieDelete: vi.fn(),
    cookieGet: vi.fn(),
    cookieSet: vi.fn(),
    createOpaqueToken: vi.fn(() => ({ hash: "invitation-hash", token: "invitation-token-value" })),
    createProvider: vi.fn(),
    decryptSecret: vi.fn((value: string) => `decrypted:${value}`),
    encryptSecret: vi.fn((value: string) => `encrypted:${value}`),
    hashInvitationToken: vi.fn((value: string) => `invitation:${value}`),
    hashOpaqueToken: vi.fn((value: string) => `session:${value}`),
    mkdir: vi.fn(),
    normalizeRepositoryLocator: vi.fn((_kind: string, value: string) => `normalized:${value}`),
    optionalUser: vi.fn(),
    providerForConnection: vi.fn(),
    redirect: vi.fn((destination: string) => {
      throw new Error(`REDIRECT:${destination}`);
    }),
    rename: vi.fn(),
    rm: vi.fn(),
    repo: {
      takeAuthAttempt: vi.fn(),
      beginTotpSetup: vi.fn(),
      getSecurityUser: vi.fn(),
      consumeTotp: vi.fn(),
      getAuthenticationSession: vi.fn(),
      changePassword: vi.fn(),
      acceptInvitation: vi.fn(),
      createOperator: vi.fn(),
      createProjectComponent: vi.fn(),
      createSession: vi.fn(),
      createUser: vi.fn(),
      createDraftDocument: vi.fn(),
      deleteSession: vi.fn(),
      enqueueBranchSync: vi.fn(),
      enqueueReviewCreation: vi.fn(),
      getProjectJob: vi.fn(),
      findUserByEmail: vi.fn(),
      getConnection: vi.fn(),
      getInvitation: vi.fn(),
      getProjectSettings: vi.fn(),
      getProjectSyncTarget: vi.fn(),
      listConnectionProjects: vi.fn().mockResolvedValue([]),
      listConnectionRepositories: vi.fn(),
      queueChangeSetSubmission: vi.fn(),
      retryChangeSetSubmission: vi.fn(),
      recordAttachment: vi.fn(),
      requireProjectAccess: vi.fn(),
      resolveConflict: vi.fn(),
    },
    requireOperator: vi.fn(),
    requireUser: vi.fn(),
    revalidatePath: vi.fn(),
    user,
    writeFile: vi.fn(),
  };
});

vi.mock("node:fs/promises", () => ({
  mkdir: mocks.mkdir,
  rename: mocks.rename,
  rm: mocks.rm,
  writeFile: mocks.writeFile,
}));
vi.mock("argon2", () => ({
  default: {
    argon2id: 2,
    hash: mocks.argonHash,
    verify: mocks.argonVerify,
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    delete: mocks.cookieDelete,
    get: mocks.cookieGet,
    set: mocks.cookieSet,
  })),
}));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@pushdocs/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@pushdocs/db")>();
  return {
    ...original,
    createOpaqueToken: mocks.createOpaqueToken,
    decryptSecret: mocks.decryptSecret,
    encryptSecret: mocks.encryptSecret,
    hashInvitationToken: mocks.hashInvitationToken,
    hashOpaqueToken: mocks.hashOpaqueToken,
  };
});
vi.mock("@pushdocs/providers", () => ({
  createProvider: mocks.createProvider,
  normalizeRepositoryLocator: mocks.normalizeRepositoryLocator,
}));
vi.mock("@/lib/provider", () => ({ providerForConnection: mocks.providerForConnection }));
vi.mock("@/lib/server", () => ({
  actor: mocks.actor,
  application: () => mocks.app,
  optionalUser: mocks.optionalUser,
  repository: () => mocks.repo,
  requireOperator: mocks.requireOperator,
  requireUser: mocks.requireUser,
  sessionCookieName: "pushdocs_session",
}));

import { RevisionConflictError } from "@pushdocs/db";
import {
  acceptInvitationAction,
  beginTwoFactorAction,
  bootstrapAction,
  changePasswordAction,
  createCommentAction,
  createConnectionAction,
  createDocumentAction,
  createProjectAction,
  createProjectComponentAction,
  criticalSettingsAction,
  deleteConnectionAction,
  deleteProjectAction,
  gitOperationStatusAction,
  inviteMemberAction,
  loginAction,
  logoutAction,
  resolveConflictAction,
  retryChangeSetSubmissionAction,
  saveConnectionSettingsAction,
  saveDraftAction,
  startGitOperationAction,
  submitChangeSetAction,
  synchronizeBranchAction,
  updateConnectionAction,
  updateProjectAction,
  uploadAttachmentAction,
  verifyTwoFactorAction,
} from "./actions";

function form(values: Record<string, string | File>): FormData {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

const projectId = "3b63fe90-f569-4e0e-89e9-153948ba5a9e";
const connectionId = "9d2c893f-8785-4b03-8568-e32655679be8";
const changeSetId = "3532ba1e-d459-4d52-98af-27c958504046";
const vpnProfile = `client
tls-client
dev tun
proto tcp
remote vpn.example.test 1194
pull
remote-cert-tls server
<ca>
-----BEGIN CERTIFICATE-----
ca
-----END CERTIFICATE-----
</ca>
<cert>
-----BEGIN CERTIFICATE-----
cert
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
key
-----END PRIVATE KEY-----
</key>`;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.optionalUser.mockResolvedValue(null);
  mocks.requireOperator.mockResolvedValue(mocks.user);
  mocks.requireUser.mockResolvedValue(mocks.user);
  mocks.argonHash.mockResolvedValue("password-hash");
  mocks.argonVerify.mockResolvedValue(true);
  mocks.repo.takeAuthAttempt.mockResolvedValue(true);
  mocks.repo.consumeTotp.mockResolvedValue(true);
  mocks.repo.getSecurityUser.mockResolvedValue({
    id: "user",
    totp_secret: "encrypted",
    password_hash: "hash",
  });
  mocks.repo.changePassword.mockResolvedValue(true);
  mocks.repo.getAuthenticationSession.mockResolvedValue({ id: "user", purpose: "mfa" });
  mocks.repo.createOperator.mockResolvedValue({ id: "operator" });
  mocks.repo.createUser.mockResolvedValue({ id: "created-user" });
  mocks.repo.acceptInvitation.mockResolvedValue({ projectId });
  mocks.app.createProject.mockResolvedValue({ id: projectId });
  mocks.app.saveDraft.mockResolvedValue({ changeSetId, revision: 2 });
  mocks.createProvider.mockReturnValue({
    getRepository: vi.fn().mockResolvedValue({
      cloneUrl: "https://git.test/acme/docs.git",
      defaultBranch: "main",
      fullName: "acme/docs",
      id: "42",
      webUrl: "https://git.test/acme/docs",
    }),
    listBranches: vi.fn().mockResolvedValue([
      { name: "main", sha: "head" },
      { name: "stable", sha: "stable-head" },
    ]),
  });
  mocks.providerForConnection.mockImplementation(async () => mocks.createProvider());
});

describe("authentication actions", () => {
  it("redirects an existing user away from setup", async () => {
    mocks.optionalUser.mockResolvedValue(mocks.user);
    await expect(
      bootstrapAction(
        form({
          displayName: "Admin",
          email: "admin@example.test",
          password: "correct horse battery staple",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/projects");
    expect(mocks.repo.createOperator).not.toHaveBeenCalled();
  });

  it("creates the first operator with only a setup session", async () => {
    await expect(
      bootstrapAction(
        form({
          displayName: " Admin ",
          email: "ADMIN@EXAMPLE.TEST",
          password: "correct horse battery staple",
        }),
      ),
    ).rejects.toThrow("REDIRECT:/two-factor");
    expect(mocks.argonHash).toHaveBeenCalledWith("correct horse battery staple", { type: 2 });
    expect(mocks.repo.createOperator).toHaveBeenCalledWith({
      displayName: "Admin",
      email: "admin@example.test",
      password: "correct horse battery staple",
      passwordHash: "password-hash",
    });
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "operator",
      expect.stringMatching(/^session:/),
      expect.any(Date),
      "setup",
      false,
    );
    expect(mocks.cookieSet).toHaveBeenCalledWith(
      "pushdocs_session",
      expect.any(String),
      expect.objectContaining({ httpOnly: true, path: "/", sameSite: "lax" }),
    );
  });

  it("rejects unknown users and invalid passwords", async () => {
    mocks.repo.findUserByEmail.mockResolvedValue(undefined);
    await expect(
      loginAction(form({ email: "missing@example.test", password: "password" })),
    ).rejects.toThrow("REDIRECT:/login?error=credentials");
    expect(mocks.argonVerify).not.toHaveBeenCalled();

    mocks.repo.findUserByEmail.mockResolvedValue({ id: "user", password_hash: "hash" });
    mocks.argonVerify.mockResolvedValue(false);
    await expect(
      loginAction(form({ email: "user@example.test", password: "wrong" })),
    ).rejects.toThrow("REDIRECT:/login?error=credentials");
  });

  it("allows password-only login only for the migrated owner", async () => {
    mocks.repo.findUserByEmail.mockResolvedValue({
      id: "user",
      password_hash: "hash",
      legacy_password_login: true,
    });
    await expect(
      loginAction(form({ email: "USER@EXAMPLE.TEST", password: "password" })),
    ).rejects.toThrow("REDIRECT:/projects");
    expect(mocks.argonVerify).toHaveBeenCalledWith("hash", "password");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "user",
      expect.stringMatching(/^session:/),
      expect.any(Date),
      "full",
      false,
    );
  });

  it("deletes the stored session on logout", async () => {
    mocks.cookieGet.mockReturnValue({ value: "token" });
    await expect(logoutAction()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.repo.deleteSession).toHaveBeenCalledWith("session:token");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("pushdocs_session");
  });

  it("logs out without a stored session", async () => {
    mocks.cookieGet.mockReturnValue(undefined);
    await expect(logoutAction()).rejects.toThrow("REDIRECT:/login");
    expect(mocks.repo.deleteSession).not.toHaveBeenCalled();
  });
});

describe("two-factor actions", () => {
  it("does not grant a full session after password authentication", async () => {
    mocks.repo.findUserByEmail.mockResolvedValue({
      id: "user",
      password_hash: "hash",
      totp_secret: "encrypted",
    });
    await expect(
      loginAction(form({ email: "user@example.test", password: "password" })),
    ).rejects.toThrow("REDIRECT:/two-factor");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "user",
      expect.any(String),
      expect.any(Date),
      "mfa",
      false,
    );
  });

  it("requires setup for every new account", async () => {
    mocks.repo.findUserByEmail.mockResolvedValue({
      id: "user",
      password_hash: "hash",
      legacy_password_login: false,
    });
    await expect(
      loginAction(form({ email: "user@example.test", password: "password" })),
    ).rejects.toThrow("REDIRECT:/two-factor");
    expect(mocks.repo.beginTotpSetup).toHaveBeenCalledWith("user");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "user",
      expect.any(String),
      expect.any(Date),
      "setup",
      false,
    );
  });

  it("requires enrollment after accepting a new invitation", async () => {
    mocks.repo.getInvitation.mockResolvedValue({ email: "new@example.test", projectId });
    mocks.repo.findUserByEmail.mockResolvedValue(undefined);
    mocks.repo.getSecurityUser.mockResolvedValue({ id: "created-user", totp_secret: null });
    await expect(
      acceptInvitationAction(
        form({ token: "a".repeat(32), displayName: "New user", password: "a secure password" }),
      ),
    ).rejects.toThrow("REDIRECT:/two-factor");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "created-user",
      expect.any(String),
      expect.any(Date),
      "setup",
      false,
    );
  });

  it("rejects a bad code without creating an authenticated session", async () => {
    mocks.cookieGet.mockReturnValue({ value: "pending" });
    mocks.repo.consumeTotp.mockResolvedValue(false);
    await expect(verifyTwoFactorAction(form({ otp: "123456" }))).rejects.toThrow(
      "REDIRECT:/two-factor?error=code",
    );
    expect(mocks.repo.createSession).not.toHaveBeenCalled();
  });

  it("rotates the pending session only after a verified code", async () => {
    mocks.cookieGet.mockReturnValue({ value: "pending" });
    await expect(verifyTwoFactorAction(form({ otp: "123456" }))).rejects.toThrow(
      "REDIRECT:/projects",
    );
    expect(mocks.repo.consumeTotp).toHaveBeenCalledWith("user", "123456", false);
    expect(mocks.repo.deleteSession).toHaveBeenCalledWith("session:pending");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "user",
      expect.any(String),
      expect.any(Date),
      "full",
      true,
    );
  });

  it("requires the current password before the legacy owner sees a setup secret", async () => {
    mocks.cookieGet.mockReturnValue({ value: "legacy" });
    mocks.repo.getAuthenticationSession.mockResolvedValue({ id: "user", purpose: "full" });
    mocks.argonVerify.mockResolvedValue(false);
    await expect(beginTwoFactorAction(form({ password: "wrong" }))).rejects.toThrow(
      "REDIRECT:/settings/profile?error=password",
    );
    expect(mocks.repo.beginTotpSetup).not.toHaveBeenCalled();
  });

  it.each([
    createConnectionAction,
    updateConnectionAction,
    deleteConnectionAction,
    createProjectAction,
    updateProjectAction,
    deleteProjectAction,
  ])("blocks a critical action when verification fails", async (action) => {
    mocks.repo.consumeTotp.mockResolvedValue(false);
    await expect(action(form({ otp: "123456" }))).rejects.toThrow("Код 2FA");
    expect(mocks.repo.getConnection).not.toHaveBeenCalled();
    expect(mocks.repo.getProjectSettings).not.toHaveBeenCalled();
    for (const method of [
      mocks.app.createConnection,
      mocks.app.updateConnection,
      mocks.app.deleteConnection,
      mocks.app.createProject,
      mocks.app.updateProject,
      mocks.app.deleteProject,
    ])
      expect(method).not.toHaveBeenCalled();
  });

  it("does not exempt the legacy owner from critical actions", async () => {
    mocks.repo.getSecurityUser.mockResolvedValue({
      id: "user",
      totp_secret: null,
      legacy_password_login: true,
    });
    expect(await criticalSettingsAction("createProject", form({}))).toEqual({
      error: "Сначала подключите 2FA в настройках профиля.",
    });
    expect(mocks.app.createProject).not.toHaveBeenCalled();
  });

  it("requires both password and 2FA to change the password", async () => {
    mocks.repo.consumeTotp.mockResolvedValue(false);
    await expect(
      changePasswordAction(
        form({ password: "old", newPassword: "new secure password", otp: "123456" }),
      ),
    ).rejects.toThrow("Код 2FA");
    expect(mocks.repo.changePassword).not.toHaveBeenCalled();
    mocks.repo.consumeTotp.mockResolvedValue(true);
    await expect(
      changePasswordAction(
        form({ password: "old", newPassword: "new secure password", otp: "654321" }),
      ),
    ).rejects.toThrow("REDIRECT:/login?changed=1");
    expect(mocks.repo.changePassword).toHaveBeenCalledWith("user", "hash", "password-hash");
    expect(mocks.cookieDelete).toHaveBeenCalledWith("pushdocs_session");
  });
});

describe("installation actions", () => {
  it("encrypts provider credentials before storage", async () => {
    await createConnectionAction(
      form({
        baseUrl: "https://gitlab.test",
        kind: "gitlab",
        name: "GitLab",
        token: "plain-token",
      }),
    );
    expect(mocks.app.createConnection).toHaveBeenCalledWith(
      { id: "user", isInstanceOperator: true },
      {
        baseUrl: "https://gitlab.test",
        kind: "gitlab",
        name: "GitLab",
        secretEncrypted: "encrypted:plain-token",
      },
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/settings/connections");
  });

  it("validates and encrypts an uploaded OpenVPN profile", async () => {
    await createConnectionAction(
      form({
        baseUrl: "https://gitlab.internal.test",
        kind: "gitlab",
        name: "Corporate GitLab",
        token: "plain-token",
        vpnProfile: new File([vpnProfile], "client.ovpn", { type: "text/plain" }),
      }),
    );
    expect(mocks.app.createConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vpnProfileEncrypted: expect.stringMatching(/^encrypted:client/) }),
    );
  });

  it("imports verified repository metadata and its default branch", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      secret_encrypted: "encrypted",
    });
    await expect(
      createProjectAction(
        form({
          connectionId,
          name: "Docs",
          repositoryProviderId: "group/docs",
          rootPath: ".",
          slug: "docs",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/projects/${projectId}/documents`);
    expect(mocks.normalizeRepositoryLocator).toHaveBeenCalledWith("gitlab", "group/docs");
    expect(mocks.app.createProject).toHaveBeenCalledWith(
      { id: "user", isInstanceOperator: true },
      expect.objectContaining({
        defaultBranch: "main",
        repositoryFullName: "acme/docs",
        repositoryProviderId: "42",
        repositoryUrl: "https://git.test/acme/docs.git",
      }),
    );
    expect(mocks.createProvider.mock.results[0]?.value.listBranches).toHaveBeenCalledWith("42");
  });

  it("keeps an explicit default branch", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://github.com",
      kind: "github",
      secret_encrypted: "encrypted",
    });
    await expect(
      createProjectAction(
        form({
          connectionId,
          defaultBranch: "stable",
          name: "Docs",
          repositoryProviderId: "acme/docs",
          slug: "docs",
        }),
      ),
    ).rejects.toThrow("REDIRECT:");
    expect(mocks.app.createProject).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ defaultBranch: "stable" }),
    );
  });

  it("rejects an unknown provider connection", async () => {
    mocks.repo.getConnection.mockResolvedValue(undefined);
    await expect(
      createProjectAction(
        form({
          connectionId,
          name: "Docs",
          repositoryProviderId: "group/docs",
          slug: "docs",
        }),
      ),
    ).rejects.toThrow("CONNECTION_NOT_FOUND");
  });

  it("verifies and encrypts replacement connection credentials", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    mocks.repo.listConnectionRepositories.mockResolvedValue(["42"]);
    mocks.repo.listConnectionProjects.mockResolvedValue([
      { default_branch: "main", id: projectId },
    ]);
    await updateConnectionAction(
      form({
        baseUrl: "https://gitlab.test",
        connectionId,
        name: "GitLab updated",
        token: "new-token",
      }),
    );
    const provider = mocks.createProvider.mock.results.at(-1)?.value;
    expect(provider.listBranches).toHaveBeenCalledWith("42");
    expect(mocks.app.updateConnection).toHaveBeenCalledWith(expect.anything(), {
      baseUrl: "https://gitlab.test",
      connectionId,
      name: "GitLab updated",
      secretEncrypted: "encrypted:new-token",
    });
    expect(mocks.repo.enqueueBranchSync).toHaveBeenCalledWith(projectId, "main");
  });

  it("returns a safe result for connection settings forms", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    mocks.repo.listConnectionRepositories.mockResolvedValue(["42"]);
    await expect(
      saveConnectionSettingsAction(
        form({
          baseUrl: "https://other-gitlab.test",
          connectionId,
          name: "GitLab",
        }),
      ),
    ).resolves.toEqual({
      ok: false,
      message: "Адрес нельзя изменить, пока подключение используется проектами.",
    });
  });

  it("keeps the current connection token when only metadata changes", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    await updateConnectionAction(
      form({ baseUrl: "https://gitlab.test", connectionId, name: "GitLab renamed" }),
    );
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.app.updateConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.not.objectContaining({ secretEncrypted: expect.anything() }),
    );
  });

  it("requires the connection name before deletion", async () => {
    mocks.repo.getConnection.mockResolvedValue({ name: "GitLab" });
    await expect(
      deleteConnectionAction(form({ confirmation: "wrong", connectionId })),
    ).rejects.toThrow("CONFIRMATION_MISMATCH");
    expect(mocks.app.deleteConnection).not.toHaveBeenCalled();
    await expect(
      deleteConnectionAction(form({ confirmation: "GitLab", connectionId })),
    ).rejects.toThrow("REDIRECT:/settings/connections");
    expect(mocks.app.deleteConnection).toHaveBeenCalledWith(expect.anything(), connectionId);
  });

  it("updates project settings and queues the configured branch", async () => {
    mocks.repo.getProjectSettings.mockResolvedValue({ default_branch: "stable", slug: "docs" });
    await updateProjectAction(
      form({
        defaultBranch: "stable",
        name: "Docs updated",
        projectId,
        rootPath: "website",
        slug: "docs-updated",
      }),
    );
    expect(mocks.app.updateProject).toHaveBeenCalledWith(expect.anything(), {
      defaultBranch: "stable",
      name: "Docs updated",
      projectId,
      rootPath: "website",
      slug: "docs-updated",
    });
    expect(mocks.repo.enqueueBranchSync).toHaveBeenCalledWith(projectId, "stable");
  });

  it("requires the project slug before deleting data and attachments", async () => {
    mocks.repo.getProjectSettings.mockResolvedValue({ slug: "docs" });
    await expect(deleteProjectAction(form({ confirmation: "wrong", projectId }))).rejects.toThrow(
      "CONFIRMATION_MISMATCH",
    );
    expect(mocks.app.deleteProject).not.toHaveBeenCalled();
    await expect(deleteProjectAction(form({ confirmation: "docs", projectId }))).rejects.toThrow(
      "REDIRECT:/projects",
    );
    expect(mocks.app.deleteProject).toHaveBeenCalledWith(expect.anything(), projectId);
    expect(mocks.rm).toHaveBeenCalledWith(expect.stringContaining(projectId), {
      force: true,
      recursive: true,
    });
  });
});

describe("document and review actions", () => {
  it("saves a draft and reports optimistic conflicts", async () => {
    const input = form({
      baseCommitSha: "abcdef0",
      branch: "main",
      content: "# Updated",
      expectedRevision: "1",
      path: "docs/a.md",
      projectId,
    });
    await expect(saveDraftAction(input)).resolves.toEqual({ revision: 2 });
    expect(mocks.app.saveDraft).toHaveBeenCalledWith(
      { id: "user", isInstanceOperator: true },
      expect.objectContaining({ expectedRevision: 1, projectId }),
    );
    mocks.app.saveDraft.mockRejectedValueOnce(new RevisionConflictError("stale"));
    await expect(saveDraftAction(input)).resolves.toEqual({ error: "conflict" });
    mocks.app.saveDraft.mockRejectedValueOnce(new Error("database failed"));
    await expect(saveDraftAction(input)).rejects.toThrow("database failed");
  });

  it("creates document comments", async () => {
    await createCommentAction(
      form({ body: "Check this", branch: "main", documentPath: "docs/a.md", projectId }),
    );
    expect(mocks.app.createComment).toHaveBeenCalledWith(expect.anything(), {
      anchorQuote: null,
      body: "Check this",
      branch: "main",
      documentPath: "docs/a.md",
      projectId,
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${projectId}/documents`);
  });

  it("invites a project member with an opaque token", async () => {
    await expect(
      inviteMemberAction(form({ email: "reader@example.test", projectId, role: "reader" })),
    ).rejects.toThrow("REDIRECT:");
    expect(mocks.app.inviteMember).toHaveBeenCalledWith(expect.anything(), {
      email: "reader@example.test",
      projectId,
      role: "reader",
      tokenHash: "invitation-hash",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/projects/${projectId}/settings/members?invitation=invitation-token-value`,
    );
  });

  it("queues branch synchronization after checking access", async () => {
    mocks.repo.enqueueBranchSync.mockResolvedValueOnce("job");
    await expect(synchronizeBranchAction(form({ branch: "docs/update", projectId }))).resolves.toBe(
      "job",
    );
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "project:read");
    expect(mocks.repo.enqueueBranchSync).toHaveBeenCalledWith(projectId, "docs/update");
  });

  it("queues a change set submission and parses the checkbox", async () => {
    await submitChangeSetAction(
      form({
        branch: "docs/update",
        changeSetId,
        createReview: "on",
        message: "Update docs",
        projectId,
      }),
    );
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "branch:push");
    expect(mocks.repo.queueChangeSetSubmission).toHaveBeenCalledWith({
      userId: "user",
      branch: "docs/update",
      changeSetId,
      createReview: true,
      message: "Update docs",
      projectId,
    });
  });

  it("redirects to the new MR branch only after the drafts are queued", async () => {
    await expect(
      submitChangeSetAction(
        form({
          projectId,
          changeSetId,
          branch: "stable",
          newBranch: "docs/new",
          createReview: "on",
          message: "New article",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/projects/${projectId}/changes?branch=docs%2Fnew`);
    expect(mocks.repo.queueChangeSetSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ newBranch: "docs/new", createReview: true }),
    );
  });
  it("checks push permission before creating a review and read permission before pulling", async () => {
    await startGitOperationAction({ projectId, branch: "docs/update", title: "Review" });
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "branch:push");
    expect(mocks.repo.enqueueReviewCreation).toHaveBeenCalledWith(
      projectId,
      "docs/update",
      "Review",
      "user",
    );
    await startGitOperationAction({ projectId, branch: "docs/update" });
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "project:read");
  });
  it("scopes operation status to an accessible project", async () => {
    mocks.repo.getProjectJob.mockResolvedValue({ status: "done" });
    expect(await gitOperationStatusAction(projectId, "job")).toEqual({ status: "done" });
    expect(mocks.repo.getProjectJob).toHaveBeenCalledWith(projectId, "job");
    mocks.repo.requireProjectAccess.mockRejectedValueOnce(new Error("denied"));
    await expect(gitOperationStatusAction(projectId, "job")).rejects.toThrow("denied");
  });

  it("retries the existing submission using the signed-in actor", async () => {
    await retryChangeSetSubmissionAction(form({ projectId, changeSetId }));
    expect(mocks.repo.retryChangeSetSubmission).toHaveBeenCalledWith(
      changeSetId,
      projectId,
      "user",
    );
  });

  it("resolves conflicts after checking document access", async () => {
    await resolveConflictAction(
      form({
        conflictId: changeSetId,
        projectId,
        resolution: "manual",
        resolvedContent: "# Combined",
      }),
    );
    expect(mocks.repo.resolveConflict).toHaveBeenCalledWith({
      conflictId: changeSetId,
      projectId,
      resolution: "manual",
      resolvedContent: "# Combined",
    });
    expect(mocks.revalidatePath).toHaveBeenCalledWith(`/projects/${projectId}/changes`);
  });

  it("stores a configured MDX component", async () => {
    await createProjectComponentAction(
      form({
        description: "Warning box",
        label: "Warning",
        name: "Docs.Warning",
        projectId,
        snippet: "<Docs.Warning />",
      }),
    );
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith(
      "user",
      projectId,
      "project:configure",
    );
    expect(mocks.repo.createProjectComponent).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Docs.Warning", projectId }),
    );
  });

  it("creates a valid MDX document and redirects to it", async () => {
    await expect(
      createDocumentAction(
        form({
          branch: "docs/update",
          path: "docs/getting-started.mdx",
          projectId,
          title: "Начало",
        }),
      ),
    ).rejects.toThrow("REDIRECT:");
    expect(mocks.repo.createDraftDocument).toHaveBeenCalledWith({
      branch: "docs/update",
      content: '---\ntitle: "Начало"\n---\n\n# Начало\n',
      path: "docs/getting-started.mdx",
      projectId,
      title: "Начало",
      userId: "user",
    });
    expect(mocks.redirect).toHaveBeenCalledWith(
      `/projects/${projectId}/documents?branch=docs%2Fupdate&path=docs%2Fgetting-started.mdx`,
    );
  });
});

describe("invitation acceptance", () => {
  const invitation = { email: "reader@example.test", projectId, role: "reader" };
  const invitationForm = () =>
    form({
      displayName: "Reader",
      password: "a secure password",
      token: "a".repeat(20),
    });

  it("rejects an invalid invitation", async () => {
    mocks.repo.getInvitation.mockResolvedValue(undefined);
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow(
      "REDIRECT:/login?error=invitation",
    );
  });

  it("rejects a session for another email address", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.optionalUser.mockResolvedValue(mocks.user);
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow(
      "REDIRECT:/login?error=invitation-account",
    );
  });

  it("accepts the invitation for the current matching user", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.optionalUser.mockResolvedValue({ ...mocks.user, email: invitation.email, id: "reader" });
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow(
      `REDIRECT:/projects/${projectId}/documents`,
    );
    expect(mocks.repo.acceptInvitation).toHaveBeenCalledWith(
      `invitation:${"a".repeat(20)}`,
      "reader",
    );
    expect(mocks.repo.createSession).not.toHaveBeenCalled();
  });

  it("verifies and signs in an existing invited user", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.repo.findUserByEmail.mockResolvedValue({ id: "reader", password_hash: "hash" });
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow("REDIRECT:");
    expect(mocks.argonVerify).toHaveBeenCalledWith("hash", "a secure password");
    expect(mocks.repo.createSession).toHaveBeenCalledWith(
      "reader",
      expect.stringMatching(/^session:/),
      expect.any(Date),
      "mfa",
      false,
    );
  });

  it("rejects a bad password for an existing invited user", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.repo.findUserByEmail.mockResolvedValue({ id: "reader", password_hash: "hash" });
    mocks.argonVerify.mockResolvedValue(false);
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow(
      `REDIRECT:/invite/${"a".repeat(20)}?error=credentials`,
    );
  });

  it("creates and signs in a new invited user", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.repo.findUserByEmail.mockResolvedValue(undefined);
    await expect(acceptInvitationAction(invitationForm())).rejects.toThrow("REDIRECT:");
    expect(mocks.repo.createUser).toHaveBeenCalledWith({
      displayName: "Reader",
      email: invitation.email,
      passwordHash: "password-hash",
    });
    expect(mocks.repo.acceptInvitation).toHaveBeenCalledWith(
      `invitation:${"a".repeat(20)}`,
      "created-user",
    );
  });
});

describe("attachment uploads", () => {
  it("requires a nonempty file", async () => {
    await expect(uploadAttachmentAction(form({ branch: "main", projectId }))).rejects.toThrow(
      "FILE_REQUIRED",
    );
    await expect(
      uploadAttachmentAction(
        form({ branch: "main", file: new File([], "empty.png", { type: "image/png" }), projectId }),
      ),
    ).rejects.toThrow("FILE_REQUIRED");
  });

  it("rejects large and disallowed files", async () => {
    const large = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "large.png", {
      type: "image/png",
    });
    await expect(
      uploadAttachmentAction(form({ branch: "main", file: large, projectId })),
    ).rejects.toThrow("FILE_TOO_LARGE");
    const text = new File(["text"], "notes.txt", { type: "text/plain" });
    await expect(
      uploadAttachmentAction(form({ branch: "main", file: text, projectId })),
    ).rejects.toThrow("FILE_TYPE_NOT_ALLOWED");
  });

  it("writes an allowed file atomically and records it", async () => {
    const previous = process.env.PUSHDOCS_ATTACHMENTS_DIR;
    process.env.PUSHDOCS_ATTACHMENTS_DIR = "/tmp/pushdocs-test-attachments";
    const file = new File(["image"], "Пример image.PNG", { type: "image/png" });
    await uploadAttachmentAction(form({ branch: "main", file, projectId }));
    expect(mocks.mkdir).toHaveBeenCalledWith(expect.stringContaining(projectId), {
      mode: 0o700,
      recursive: true,
    });
    expect(mocks.writeFile).toHaveBeenCalledWith(
      expect.stringMatching(/\.png\.uploading$/),
      Buffer.from("image"),
      { flag: "wx", mode: 0o600 },
    );
    expect(mocks.rename).toHaveBeenCalledWith(
      expect.stringMatching(/\.uploading$/),
      expect.stringMatching(/\.png$/),
    );
    expect(mocks.repo.recordAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        branch: "main",
        mediaType: "image/png",
        originalName: "Пример image.PNG",
        projectId,
        repositoryPath: expect.stringMatching(/^static\/img\/[0-9a-f]{10}-image\.png$/),
        sha256: "6105d6cc76af400325e94d588ce511be5bfdbb73b437dc51eca43917d7a43e3d",
        sizeBytes: 5,
        storageKey: expect.stringMatching(new RegExp(`^${projectId}/[0-9a-f]{32}\\.png$`)),
      }),
    );
    if (previous === undefined) delete process.env.PUSHDOCS_ATTACHMENTS_DIR;
    else process.env.PUSHDOCS_ATTACHMENTS_DIR = previous;
  });

  it("uses the default directory and asset name when the filename has no ASCII stem", async () => {
    const previous = process.env.PUSHDOCS_ATTACHMENTS_DIR;
    delete process.env.PUSHDOCS_ATTACHMENTS_DIR;
    const file = new File(["pdf"], "пример.PDF", { type: "application/pdf" });
    await uploadAttachmentAction(form({ branch: "main", file, projectId }));
    expect(mocks.repo.recordAttachment).toHaveBeenCalledWith(
      expect.objectContaining({
        repositoryPath: expect.stringMatching(/^static\/img\/[0-9a-f]{10}-asset\.pdf$/),
        storageKey: expect.stringMatching(/\.pdf$/),
      }),
    );
    if (previous !== undefined) process.env.PUSHDOCS_ATTACHMENTS_DIR = previous;
  });
});
