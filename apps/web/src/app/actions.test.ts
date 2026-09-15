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
    clearVpnAccess: vi.fn(),
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
      manageMember: vi.fn(),
      revokeInvitation: vi.fn(),
      enqueueReviewsSync: vi.fn(),
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
      enqueueBranchSyncIfStale: vi.fn(),
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
vi.mock("@pushdocs/vpn", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pushdocs/vpn")>()),
  clearVpnAccess: mocks.clearVpnAccess,
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
  inspectProjectRepository,
  inviteMemberAction,
  loginAction,
  logoutAction,
  manageMemberAction,
  resolveConflictAction,
  retryChangeSetSubmissionAction,
  revokeInvitationAction,
  saveConnectionSettingsAction,
  saveDraftAction,
  startBackgroundBranchSyncAction,
  startGitOperationAction,
  submitChangeSetAction,
  synchronizeBranchAction,
  twoFactorStatusAction,
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
  process.env.PUSHDOCS_VPN_ENABLED = "1";
  mocks.optionalUser.mockResolvedValue(null);
  mocks.requireOperator.mockResolvedValue(mocks.user);
  mocks.requireUser.mockResolvedValue(mocks.user);
  mocks.argonHash.mockResolvedValue("password-hash");
  mocks.argonVerify.mockResolvedValue(true);
  mocks.clearVpnAccess.mockResolvedValue(undefined);
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
    listFiles: vi.fn().mockResolvedValue(["site/docusaurus.config.ts", "README.md"]),
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
  it("redirects an already verified session and completes a fresh setup", async () => {
    mocks.cookieGet.mockReturnValue({ value: "pending" });
    mocks.repo.getAuthenticationSession.mockResolvedValueOnce({ id: "user", purpose: "full" });
    await expect(verifyTwoFactorAction(form({ otp: "123456" }))).rejects.toThrow(
      "REDIRECT:/settings/profile",
    );

    mocks.repo.getAuthenticationSession.mockResolvedValueOnce({ id: "user", purpose: "mfa" });
    mocks.repo.getSecurityUser.mockResolvedValueOnce({
      id: "user",
      password_hash: "hash",
      totp_secret: null,
    });
    await expect(beginTwoFactorAction(form({ password: "correct" }))).rejects.toThrow(
      "REDIRECT:/two-factor",
    );
    expect(mocks.repo.beginTotpSetup).toHaveBeenCalledWith("user");
  });

  it("does not start setup when the verified user already has a secret", async () => {
    mocks.cookieGet.mockReturnValue({ value: "verified" });
    mocks.repo.getAuthenticationSession.mockResolvedValue({ id: "user", purpose: "full" });
    mocks.repo.getSecurityUser.mockResolvedValue({
      id: "user",
      password_hash: "hash",
      totp_secret: "encrypted-secret",
    });
    await expect(beginTwoFactorAction(form({ password: "correct" }))).rejects.toThrow(
      "REDIRECT:/settings/profile",
    );
    expect(mocks.repo.beginTotpSetup).not.toHaveBeenCalled();
  });

  it("rejects unsafe password changes and concurrent updates", async () => {
    await expect(
      changePasswordAction(form({ password: "old", newPassword: "short", otp: "123456" })),
    ).rejects.toThrow("от 12 до 200");
    mocks.argonVerify.mockResolvedValueOnce(false);
    await expect(
      changePasswordAction(
        form({ password: "wrong", newPassword: "a secure new password", otp: "123456" }),
      ),
    ).rejects.toThrow("Текущий пароль неверен");
    mocks.repo.changePassword.mockResolvedValueOnce(false);
    await expect(
      changePasswordAction(
        form({ password: "old", newPassword: "a secure new password", otp: "123456" }),
      ),
    ).rejects.toThrow("Пароль уже изменён");
  });

  it("normalizes critical form failures and rejects unknown actions", async () => {
    await expect(criticalSettingsAction("unknown", form({}))).rejects.toThrow(
      "Unknown settings action",
    );
    mocks.app.updateProject.mockResolvedValueOnce(undefined);
    mocks.repo.getProjectSettings.mockResolvedValueOnce({
      default_branch: "main",
      root_path: ".",
    });
    await expect(
      criticalSettingsAction(
        "updateProject",
        form({
          defaultBranch: "main",
          name: "Docs",
          projectId,
          rootPath: ".",
          slug: "docs",
          otp: "123456",
        }),
      ),
    ).resolves.toEqual({});
    mocks.repo.manageMember.mockRejectedValueOnce(
      new Error("Нельзя удалить или понизить роль последнего администратора"),
    );
    await expect(
      criticalSettingsAction(
        "manageMember",
        form({ projectId, userId: connectionId, role: "remove", otp: "123456" }),
      ),
    ).resolves.toEqual({ error: "Нельзя удалить или понизить роль последнего администратора" });
    mocks.app.updateProject.mockRejectedValueOnce(new Error("database failed"));
    mocks.repo.getProjectSettings.mockResolvedValueOnce({
      default_branch: "main",
      root_path: ".",
    });
    await expect(
      criticalSettingsAction(
        "updateProject",
        form({
          defaultBranch: "main",
          name: "Docs",
          projectId,
          rootPath: ".",
          slug: "docs",
          otp: "123456",
        }),
      ),
    ).rejects.toThrow("database failed");
  });

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

  it("normalizes omitted verification fields and redirects an MFA session locally", async () => {
    mocks.cookieGet.mockReturnValue({ value: "pending" });
    mocks.repo.consumeTotp.mockResolvedValueOnce(false);
    await expect(verifyTwoFactorAction(form({}))).rejects.toThrow(
      "REDIRECT:/two-factor?error=code",
    );
    expect(mocks.repo.consumeTotp).toHaveBeenCalledWith("user", "", false);

    mocks.argonVerify.mockResolvedValueOnce(false);
    await expect(beginTwoFactorAction(form({}))).rejects.toThrow(
      "REDIRECT:/two-factor?error=password",
    );
    expect(mocks.argonVerify).toHaveBeenCalledWith("hash", "");

    await expect(changePasswordAction(form({}))).rejects.toThrow("от 12 до 200");
    mocks.argonVerify.mockResolvedValueOnce(false);
    await expect(
      changePasswordAction(form({ newPassword: "a secure new password" })),
    ).rejects.toThrow("Текущий пароль неверен");
    expect(mocks.argonVerify).toHaveBeenLastCalledWith("hash", "");
  });

  it.each([
    createConnectionAction,
    updateConnectionAction,
    deleteConnectionAction,
    createProjectAction,
    manageMemberAction,
    revokeInvitationAction,
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

  it("allows critical actions without setting up 2FA when it is not configured", async () => {
    mocks.repo.getSecurityUser.mockResolvedValue({
      id: "user",
      totp_secret: null,
      legacy_password_login: true,
    });
    expect(
      await criticalSettingsAction(
        "manageMember",
        form({ projectId, userId: connectionId, role: "editor" }),
      ),
    ).toEqual({});
    expect(mocks.repo.consumeTotp).not.toHaveBeenCalled();
    expect(mocks.repo.manageMember).toHaveBeenCalledWith({
      actorId: "user",
      projectId,
      userId: connectionId,
      role: "editor",
    });
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
  it("rejects VPN uploads when the installation feature is disabled", async () => {
    process.env.PUSHDOCS_VPN_ENABLED = "0";
    await expect(
      createConnectionAction(
        form({
          baseUrl: "https://gitlab.internal.test",
          kind: "gitlab",
          name: "Corporate GitLab",
          token: "plain-token",
          vpnProfile: new File([vpnProfile], "client.ovpn"),
        }),
      ),
    ).rejects.toThrow("VPN_DISABLED");
    expect(mocks.app.createConnection).not.toHaveBeenCalled();
  });

  it("rejects invalid VPN uploads and incompatible providers", async () => {
    const values = {
      baseUrl: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      token: "plain-token",
    };
    await expect(
      createConnectionAction(form({ ...values, vpnProfile: new File([vpnProfile], "client.txt") })),
    ).rejects.toThrow("VPN_PROFILE_INVALID_FILE");
    await expect(
      createConnectionAction(
        form({
          ...values,
          kind: "github",
          baseUrl: "https://github.com",
          vpnProfile: new File([vpnProfile], "client.ovpn"),
        }),
      ),
    ).rejects.toThrow("VPN_REQUIRES_HTTPS_GITLAB");
  });

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

  it("refreshes a project-scoped connection page after creation", async () => {
    await createConnectionAction(
      form({
        baseUrl: "https://gitlab.test",
        kind: "gitlab",
        name: "GitLab",
        projectId,
        token: "plain-token",
      }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/projects/${projectId}/settings/connections`,
    );
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
      message:
        "Для другого сервера укажите новый access token. Сохранённый токен не будет отправлен на новый адрес.",
    });
  });

  it("validates an in-use connection address and refreshes clone URLs before saving", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      id: connectionId,
      base_url: "https://gitlab.test",
      kind: "gitlab",
      secret_encrypted: "encrypted:old",
    });
    mocks.repo.listConnectionRepositories.mockResolvedValue(["42"]);
    const client = mocks.createProvider();
    client.getRepository.mockResolvedValue({
      cloneUrl: "https://new-gitlab.test/acme/docs.git",
      id: "42",
    });
    await updateConnectionAction(
      form({
        baseUrl: "https://new-gitlab.test",
        connectionId,
        name: "GitLab",
        token: "new-token",
      }),
    );
    expect(client.getRepository).toHaveBeenCalledWith("42");
    expect(client.listBranches).toHaveBeenCalledWith("42");
    expect(mocks.app.updateConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        baseUrl: "https://new-gitlab.test",
        repositoryCloneUrls: [
          { repositoryId: "42", cloneUrl: "https://new-gitlab.test/acme/docs.git" },
        ],
      }),
    );
    mocks.app.updateConnection.mockClear();
    client.getRepository.mockRejectedValueOnce(new Error("Access denied"));
    await expect(
      updateConnectionAction(
        form({
          baseUrl: "https://new-gitlab.test",
          connectionId,
          name: "GitLab",
          token: "new-token",
        }),
      ),
    ).rejects.toThrow("Access denied");
    expect(mocks.app.updateConnection).not.toHaveBeenCalled();
  });

  it.each([
    ["https://gitlab.test/", "http://gitlab.test/"],
    ["http://gitlab.test/", "https://gitlab.test/"],
  ])(
    "changes the same server protocol from %s to %s without replacing its token",
    async (oldUrl, newUrl) => {
      mocks.repo.getConnection.mockResolvedValue({
        id: connectionId,
        base_url: oldUrl,
        kind: "gitlab",
        secret_encrypted: "encrypted:old",
      });
      mocks.repo.listConnectionRepositories.mockResolvedValue(["42"]);
      const client = mocks.createProvider();
      client.getRepository.mockResolvedValue({ cloneUrl: `${newUrl}acme/docs.git`, id: "42" });
      await updateConnectionAction(form({ baseUrl: newUrl, connectionId, name: "GitLab" }));
      expect(mocks.providerForConnection).toHaveBeenCalledWith(
        expect.objectContaining({ base_url: newUrl, secret_encrypted: "encrypted:old" }),
      );
      expect(mocks.app.updateConnection).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          baseUrl: newUrl,
          repositoryCloneUrls: [{ repositoryId: "42", cloneUrl: `${newUrl}acme/docs.git` }],
        }),
      );
      expect(mocks.app.updateConnection).toHaveBeenCalledWith(
        expect.anything(),
        expect.not.objectContaining({ secretEncrypted: expect.anything() }),
      );
    },
  );

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

  it("revalidates a path change on the same origin with the stored token", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    mocks.repo.listConnectionRepositories.mockResolvedValueOnce([]);
    await updateConnectionAction(
      form({ baseUrl: "https://gitlab.test/new-path", connectionId, name: "GitLab" }),
    );
    expect(mocks.providerForConnection).toHaveBeenCalledWith(
      expect.objectContaining({ secret_encrypted: "encrypted:old" }),
    );
  });

  it("encrypts a replacement VPN profile", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    await updateConnectionAction(
      form({
        baseUrl: "https://gitlab.test",
        connectionId,
        name: "GitLab",
        vpnProfile: new File([vpnProfile], "client.ovpn"),
      }),
    );
    expect(mocks.app.updateConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vpnProfileEncrypted: expect.stringContaining("encrypted:client") }),
    );
  });

  it("validates connection replacement edge cases and project-scoped refreshes", async () => {
    const current = {
      id: connectionId,
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
      vpn_slot: 2,
    };
    mocks.repo.getConnection.mockResolvedValue(undefined);
    await expect(
      updateConnectionAction(form({ baseUrl: current.base_url, connectionId, name: current.name })),
    ).rejects.toThrow("CONNECTION_NOT_FOUND");

    mocks.repo.getConnection.mockResolvedValue(current);
    await expect(
      updateConnectionAction(
        form({
          baseUrl: "http://gitlab.test",
          connectionId,
          name: current.name,
          vpnProfile: new File([vpnProfile], "client.ovpn"),
        }),
      ),
    ).rejects.toThrow("VPN_REQUIRES_HTTPS_GITLAB");
    await expect(
      updateConnectionAction(
        form({
          baseUrl: current.base_url,
          connectionId,
          name: current.name,
          removeVpn: "on",
          vpnProfile: new File([vpnProfile], "client.ovpn"),
        }),
      ),
    ).rejects.toThrow("VPN_PROFILE_CHANGE_CONFLICT");

    mocks.clearVpnAccess.mockRejectedValueOnce(new Error("already cleared"));
    await updateConnectionAction(
      form({
        baseUrl: current.base_url,
        connectionId,
        name: current.name,
        projectId,
        removeVpn: "on",
      }),
    );
    expect(mocks.app.updateConnection).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ vpnProfileEncrypted: null }),
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith(
      `/projects/${projectId}/settings/connections`,
    );
  });

  it("maps every safe connection settings result", async () => {
    const input = (extra: Record<string, string | File> = {}) =>
      form({ baseUrl: "https://gitlab.test", connectionId, name: "GitLab", ...extra });
    mocks.requireOperator.mockRejectedValueOnce("bad input");
    await expect(saveConnectionSettingsAction(input())).resolves.toEqual({
      ok: false,
      message: "Не удалось сохранить настройки. Повторите попытку.",
    });
    mocks.repo.getConnection.mockResolvedValueOnce(undefined);
    await expect(saveConnectionSettingsAction(input())).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("не найдено"),
    });
    mocks.repo.getConnection.mockResolvedValue({
      id: connectionId,
      base_url: "https://gitlab.test",
      kind: "gitlab",
      name: "GitLab",
      secret_encrypted: "encrypted:old",
    });
    await expect(
      saveConnectionSettingsAction(input({ vpnProfile: new File([vpnProfile], "client.txt") })),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining(".ovpn") });
    await expect(
      saveConnectionSettingsAction(
        input({
          removeVpn: "on",
          vpnProfile: new File([vpnProfile], "client.ovpn"),
        }),
      ),
    ).resolves.toMatchObject({ ok: false, message: expect.stringContaining("одновременно") });
    mocks.repo.listConnectionRepositories.mockRejectedValueOnce(new Error("unknown"));
    await expect(saveConnectionSettingsAction(input())).resolves.toMatchObject({
      ok: false,
      message: expect.stringContaining("Проверьте данные"),
    });
    await expect(saveConnectionSettingsAction(input())).resolves.toMatchObject({ ok: true });
  });

  it("returns the two-factor failure from connection settings", async () => {
    mocks.repo.consumeTotp.mockResolvedValue(false);
    await expect(
      saveConnectionSettingsAction(
        form({ baseUrl: "https://gitlab.test", connectionId, name: "GitLab", otp: "000000" }),
      ),
    ).resolves.toEqual({
      ok: false,
      message:
        "Код 2FA неверен или уже использован. Введите новый код. После 10 попыток подождите 15 минут.",
    });
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

  it("handles missing connections and VPN cleanup failures during deletion", async () => {
    mocks.repo.getConnection.mockResolvedValueOnce(undefined);
    await expect(
      deleteConnectionAction(form({ confirmation: "GitLab", connectionId })),
    ).rejects.toThrow("CONNECTION_NOT_FOUND");
    mocks.repo.getConnection.mockResolvedValueOnce({ name: "GitLab", vpn_slot: 3 });
    mocks.clearVpnAccess.mockRejectedValueOnce(new Error("gone"));
    await expect(
      deleteConnectionAction(form({ confirmation: "GitLab", connectionId })),
    ).rejects.toThrow("REDIRECT:/settings/connections");
  });

  it("rejects missing branches and validates changed project branches", async () => {
    mocks.repo.getConnection.mockResolvedValue({
      id: connectionId,
      base_url: "https://gitlab.test",
      kind: "gitlab",
      secret_encrypted: "encrypted",
    });
    await expect(
      createProjectAction(
        form({
          connectionId,
          defaultBranch: "missing",
          name: "Docs",
          repositoryProviderId: "group/docs",
          slug: "docs",
        }),
      ),
    ).rejects.toThrow("DEFAULT_BRANCH_NOT_FOUND");

    const update = form({
      defaultBranch: "stable",
      name: "Docs",
      projectId,
      rootPath: ".",
      slug: "docs",
    });
    mocks.repo.getProjectSettings.mockResolvedValueOnce(undefined);
    await expect(updateProjectAction(update)).rejects.toThrow("PROJECT_NOT_FOUND");
    mocks.repo.getProjectSettings.mockResolvedValue({ default_branch: "main", root_path: "." });
    mocks.repo.getProjectSyncTarget.mockResolvedValueOnce(undefined);
    await expect(updateProjectAction(update)).rejects.toThrow("PROJECT_CONNECTION_NOT_FOUND");
    mocks.repo.getProjectSyncTarget.mockResolvedValue({ provider_repository_id: "42" });
    const provider = mocks.createProvider();
    provider.listBranches.mockResolvedValueOnce([{ name: "main" }]);
    mocks.providerForConnection.mockResolvedValueOnce(provider);
    await expect(updateProjectAction(update)).rejects.toThrow("DEFAULT_BRANCH_NOT_FOUND");
    await updateProjectAction(update);
    expect(mocks.repo.enqueueBranchSync).toHaveBeenCalledWith(projectId, "stable");
  });

  it("rejects deletion of a project that no longer exists", async () => {
    mocks.repo.getProjectSettings.mockResolvedValue(undefined);
    await expect(deleteProjectAction(form({ confirmation: "docs", projectId }))).rejects.toThrow(
      "PROJECT_NOT_FOUND",
    );
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

  it("uses the cached branch snapshot for a background refresh", async () => {
    mocks.repo.enqueueBranchSyncIfStale.mockResolvedValueOnce(null);
    await expect(
      startBackgroundBranchSyncAction({ branch: "docs/update", projectId }),
    ).resolves.toBe(null);
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "project:read");
    expect(mocks.repo.enqueueBranchSyncIfStale).toHaveBeenCalledWith(projectId, "docs/update");
  });

  it("always queues review creation when submitting a change set", async () => {
    await submitChangeSetAction(
      form({
        branch: "docs/update",
        changeSetId,
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
          message: "New article",
        }),
      ),
    ).rejects.toThrow(`REDIRECT:/projects/${projectId}/changes?branch=docs%2Fnew`);
    expect(mocks.repo.queueChangeSetSubmission).toHaveBeenCalledWith(
      expect.objectContaining({ newBranch: "docs/new", createReview: true }),
    );
  });
  it("checks review permission before creating a review and read permission before pulling", async () => {
    await startGitOperationAction({ projectId, branch: "docs/update", title: "Review" });
    expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith(
      "user",
      projectId,
      "change-request:create",
    );
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

  it("rejects missing jobs and exposes whether 2FA is configured", async () => {
    mocks.repo.getProjectJob.mockResolvedValue(undefined);
    await expect(gitOperationStatusAction(projectId, "missing")).rejects.toThrow(
      "Операция не найдена",
    );
    await expect(twoFactorStatusAction()).resolves.toBe(true);
    mocks.repo.getSecurityUser.mockResolvedValueOnce(undefined);
    await expect(twoFactorStatusAction()).resolves.toBe(false);
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

  it.each(["short", "", "p".repeat(201)])(
    "returns an invitation form error instead of crashing for an invalid submitted password",
    async (password) => {
      await expect(
        acceptInvitationAction(form({ displayName: "Reader", password, token: "a".repeat(20) })),
      ).rejects.toThrow(`REDIRECT:/invite/${"a".repeat(20)}?error=password`);
      expect(mocks.repo.createUser).not.toHaveBeenCalled();
      expect(mocks.repo.acceptInvitation).not.toHaveBeenCalled();
      expect(mocks.argonHash).not.toHaveBeenCalled();
    },
  );

  it("handles invalid names and tokens without creating an account", async () => {
    await expect(
      acceptInvitationAction(
        form({ displayName: "R", password: "a secure password", token: "a".repeat(20) }),
      ),
    ).rejects.toThrow(`REDIRECT:/invite/${"a".repeat(20)}?error=name`);
    await expect(
      acceptInvitationAction(
        form({ displayName: "Reader", password: "a secure password", token: "bad" }),
      ),
    ).rejects.toThrow("REDIRECT:/login?error=invitation");
    expect(mocks.repo.createUser).not.toHaveBeenCalled();
  });

  it("accepts a pasted password without altering whitespace or special characters", async () => {
    mocks.repo.getInvitation.mockResolvedValue(invitation);
    mocks.repo.findUserByEmail.mockResolvedValue(undefined);
    const pasted = "  My pasted secure password! ";
    await expect(
      acceptInvitationAction(
        form({ displayName: "Reader", password: pasted, token: "a".repeat(20) }),
      ),
    ).rejects.toThrow("REDIRECT:");
    expect(mocks.argonHash).toHaveBeenCalledWith(pasted, expect.anything());
    expect(mocks.repo.acceptInvitation).toHaveBeenCalled();
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

it("inspects repository defaults without creating a project", async () => {
  mocks.repo.getConnection.mockResolvedValue({ id: connectionId, kind: "gitlab" });
  expect(await inspectProjectRepository({ connectionId, locator: "group/docs" })).toMatchObject({
    id: "42",
    name: "docs",
    defaultBranch: "main",
    branches: ["main", "stable"],
    roots: ["site"],
  });
  expect(mocks.app.createProject).not.toHaveBeenCalled();
});
it("recognizes a repository config stored at its root", async () => {
  const provider = mocks.createProvider();
  provider.listFiles.mockResolvedValueOnce(["docusaurus.config.js"]);
  mocks.repo.getConnection.mockResolvedValue({ id: connectionId, kind: "gitlab" });
  await expect(
    inspectProjectRepository({ connectionId, locator: "group/docs" }),
  ).resolves.toMatchObject({ roots: ["."] });
});
it("requires an operator before inspecting remote repository data", async () => {
  mocks.requireOperator.mockRejectedValueOnce(new Error("denied"));
  await expect(inspectProjectRepository({ connectionId, locator: "group/docs" })).rejects.toThrow(
    "denied",
  );
  expect(mocks.providerForConnection).not.toHaveBeenCalled();
});
it("refreshes only reviews after checking project access", async () => {
  await startGitOperationAction({ projectId, branch: "main", reviewsOnly: true });
  expect(mocks.repo.requireProjectAccess).toHaveBeenCalledWith("user", projectId, "project:read");
  expect(mocks.repo.enqueueReviewsSync).toHaveBeenCalledWith(projectId);
  expect(mocks.repo.enqueueBranchSync).not.toHaveBeenCalled();
});
it("requires 2FA before changing access or revoking invitations", async () => {
  mocks.repo.consumeTotp.mockResolvedValue(false);
  const input = form({
    projectId,
    userId: connectionId,
    invitationId: connectionId,
    role: "remove",
  });
  await expect(manageMemberAction(input)).rejects.toThrow();
  await expect(revokeInvitationAction(input)).rejects.toThrow();
  expect(mocks.repo.manageMember).not.toHaveBeenCalled();
  expect(mocks.repo.revokeInvitation).not.toHaveBeenCalled();
});

it("updates member roles, removes the current user, and revokes invitations", async () => {
  await manageMemberAction(
    form({ projectId, userId: connectionId, role: "editor", otp: "123456" }),
  );
  expect(mocks.repo.manageMember).toHaveBeenCalledWith({
    actorId: "user",
    projectId,
    userId: connectionId,
    role: "editor",
  });
  mocks.requireUser.mockResolvedValueOnce({ ...mocks.user, id: connectionId });
  await expect(
    manageMemberAction(form({ projectId, userId: connectionId, role: "remove", otp: "123456" })),
  ).rejects.toThrow("REDIRECT:/projects");
  expect(mocks.repo.manageMember).toHaveBeenLastCalledWith(
    expect.objectContaining({ role: null, userId: connectionId }),
  );
  await revokeInvitationAction(form({ projectId, invitationId: connectionId, otp: "123456" }));
  expect(mocks.repo.revokeInvitation).toHaveBeenCalledWith("user", projectId, connectionId);
});

it("rejects repository inspection when the connection disappears", async () => {
  mocks.repo.getConnection.mockResolvedValue(undefined);
  await expect(inspectProjectRepository({ connectionId, locator: "group/docs" })).rejects.toThrow(
    "Подключение не найдено",
  );
});

it("does not bypass verification when the security user no longer exists", async () => {
  mocks.repo.getSecurityUser.mockResolvedValue(undefined);
  expect(
    await criticalSettingsAction(
      "manageMember",
      form({ projectId, userId: connectionId, role: "remove" }),
    ),
  ).toEqual({ error: "Пользователь не найден. Войдите снова." });
  expect(mocks.repo.manageMember).not.toHaveBeenCalled();
});
