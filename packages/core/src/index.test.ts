import { describe, expect, it, vi } from "vitest";
import { type Actor, type CoreRepository, PushDocs } from "./index";

function repository(): CoreRepository {
  return {
    createComment: vi.fn().mockResolvedValue({ id: "comment" }),
    createConnection: vi.fn().mockResolvedValue({ id: "connection" }),
    createInvitation: vi.fn().mockResolvedValue({ id: "invitation" }),
    createProject: vi.fn().mockResolvedValue({ id: "project" }),
    listDocuments: vi.fn().mockResolvedValue([{ path: "docs/a.md" }]),
    listProjects: vi.fn().mockResolvedValue([{ id: "project" }]),
    requireProjectAccess: vi.fn().mockResolvedValue({ role: "editor" }),
    saveDraft: vi.fn().mockResolvedValue({ changeSetId: "change", revision: 2 }),
  } as CoreRepository;
}

const editor: Actor = { id: "user", isInstanceOperator: false };
const operator: Actor = { id: "operator", isInstanceOperator: true };

describe("PushDocs project queries", () => {
  it("lists only projects visible to the actor", async () => {
    const port = repository();
    const app = new PushDocs(port);
    await expect(app.listProjects(editor)).resolves.toEqual([{ id: "project" }]);
    expect(port.listProjects).toHaveBeenCalledWith("user");
  });

  it("checks project membership before listing documents", async () => {
    const port = repository();
    const app = new PushDocs(port);
    await expect(app.listDocuments(editor, "project", "main")).resolves.toEqual([
      { path: "docs/a.md" },
    ]);
    expect(port.requireProjectAccess).toHaveBeenCalledWith("user", "project", "project:read");
    expect(port.listDocuments).toHaveBeenCalledWith("project", "main");
  });
});

describe("PushDocs project commands", () => {
  it("saves a draft under the acting user", async () => {
    const port = repository();
    const input = {
      baseCommitSha: "abcdef0",
      branch: "main",
      content: "# Updated",
      expectedRevision: 1,
      path: "docs/a.md",
      projectId: "project",
    };
    await expect(new PushDocs(port).saveDraft(editor, input)).resolves.toEqual({
      changeSetId: "change",
      revision: 2,
    });
    expect(port.requireProjectAccess).toHaveBeenCalledWith("user", "project", "document:write");
    expect(port.saveDraft).toHaveBeenCalledWith({ ...input, userId: "user" });
  });

  it("creates a comment under the acting user", async () => {
    const port = repository();
    const input = {
      anchorQuote: "Sentence",
      body: "Please clarify",
      branch: "main",
      documentPath: "docs/a.md",
      projectId: "project",
    };
    await expect(new PushDocs(port).createComment(editor, input)).resolves.toEqual({
      id: "comment",
    });
    expect(port.requireProjectAccess).toHaveBeenCalledWith("user", "project", "comment:create");
    expect(port.createComment).toHaveBeenCalledWith({ ...input, userId: "user" });
  });

  it("creates an invitation under the acting administrator", async () => {
    const port = repository();
    const input = {
      email: "reader@example.test",
      projectId: "project",
      role: "reader" as const,
      tokenHash: "hash",
    };
    await expect(new PushDocs(port).inviteMember(editor, input)).resolves.toEqual({
      id: "invitation",
    });
    expect(port.requireProjectAccess).toHaveBeenCalledWith("user", "project", "member:manage");
    expect(port.createInvitation).toHaveBeenCalledWith({ ...input, invitedByUserId: "user" });
  });
});

describe("PushDocs installation commands", () => {
  it("creates a project under the installation operator", async () => {
    const port = repository();
    const input = {
      connectionId: "connection",
      defaultBranch: "main",
      name: "Docs",
      repositoryFullName: "acme/docs",
      repositoryProviderId: "acme/docs",
      repositoryUrl: "https://github.com/acme/docs.git",
      rootPath: ".",
      slug: "docs",
    };
    await expect(new PushDocs(port).createProject(operator, input)).resolves.toEqual({
      id: "project",
    });
    expect(port.createProject).toHaveBeenCalledWith({ ...input, operatorUserId: "operator" });
  });

  it("creates a provider connection under the installation operator", async () => {
    const port = repository();
    const input = {
      baseUrl: "https://git.example.test",
      kind: "gitlab" as const,
      name: "GitLab",
      secretEncrypted: "secret",
    };
    await expect(new PushDocs(port).createConnection(operator, input)).resolves.toEqual({
      id: "connection",
    });
    expect(port.createConnection).toHaveBeenCalledWith(input);
  });

  it.each(["createProject", "createConnection"] as const)(
    "keeps %s separate from project roles",
    (command) => {
      const app = new PushDocs(repository());
      const input =
        command === "createProject"
          ? {
              connectionId: "connection",
              defaultBranch: "main",
              name: "Docs",
              repositoryFullName: "acme/docs",
              repositoryProviderId: "acme/docs",
              repositoryUrl: "https://github.com/acme/docs.git",
              rootPath: ".",
              slug: "docs",
            }
          : {
              baseUrl: "https://git.example.test",
              kind: "gitlab" as const,
              name: "GitLab",
              secretEncrypted: "secret",
            };
      expect(() => {
        if (command === "createProject") app.createProject(editor, input as never);
        else app.createConnection(editor, input as never);
      }).toThrow("INSTANCE_OPERATOR_REQUIRED");
    },
  );
});
