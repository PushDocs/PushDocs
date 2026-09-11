import { describe, expect, it } from "vitest";
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
  providerKindSchema,
  resolveConflictSchema,
  roleSchema,
  saveDraftSchema,
  submitChangeSetSchema,
  updateConnectionSchema,
  updateProjectSchema,
} from "./index";

const projectId = "3b63fe90-f569-4e0e-89e9-153948ba5a9e";
const changeSetId = "3532ba1e-d459-4d52-98af-27c958504046";

describe("roles and providers", () => {
  it.each(["admin", "editor", "reader"])("accepts the %s project role", (role) => {
    expect(roleSchema.parse(role)).toBe(role);
  });

  it.each(["github", "gitlab"])("accepts the %s provider", (provider) => {
    expect(providerKindSchema.parse(provider)).toBe(provider);
  });

  it("rejects unknown role and provider values", () => {
    expect(roleSchema.safeParse("owner").success).toBe(false);
    expect(providerKindSchema.safeParse("bitbucket").success).toBe(false);
  });
});

describe("authentication commands", () => {
  it("normalizes the bootstrap profile", () => {
    expect(
      bootstrapSchema.parse({
        displayName: "  Анна  ",
        email: "ADMIN@EXAMPLE.TEST",
        password: "correct horse battery staple",
      }),
    ).toEqual({
      displayName: "Анна",
      email: "admin@example.test",
      password: "correct horse battery staple",
    });
  });

  it("rejects a short bootstrap password", () => {
    expect(
      bootstrapSchema.safeParse({ displayName: "Анна", email: "a@example.test", password: "short" })
        .success,
    ).toBe(false);
  });

  it("normalizes a login email and requires a password", () => {
    expect(loginSchema.parse({ email: "USER@EXAMPLE.TEST", password: "x" }).email).toBe(
      "user@example.test",
    );
    expect(loginSchema.safeParse({ email: "user@example.test", password: "" }).success).toBe(false);
  });

  it("requires a long invitation token and password", () => {
    const valid = acceptInvitationSchema.parse({
      displayName: "Иван",
      password: "a secure password",
      token: "a".repeat(20),
    });
    expect(valid.displayName).toBe("Иван");
    expect(
      acceptInvitationSchema.safeParse({ displayName: "И", password: "short", token: "tiny" })
        .success,
    ).toBe(false);
  });
});

describe("installation and project commands", () => {
  it("parses a connection and rejects an invalid URL", () => {
    expect(
      createConnectionSchema.parse({
        baseUrl: "https://gitlab.internal.test",
        kind: "gitlab",
        name: "Internal GitLab",
        token: "secret",
      }).kind,
    ).toBe("gitlab");
    expect(
      createConnectionSchema.safeParse({
        baseUrl: "gitlab",
        kind: "gitlab",
        name: "Internal GitLab",
        token: "secret",
      }).success,
    ).toBe(false);
  });

  it("defaults a project root and leaves the provider branch optional", () => {
    const result = createProjectSchema.parse({
      connectionId: "9d2c893f-8785-4b03-8568-e32655679be8",
      name: "Sendsay Docs",
      repositoryProviderId: "sendsay-ru/frontend/sendsay-docs",
      slug: "sendsay-docs",
    });
    expect(result).toMatchObject({ rootPath: ".", slug: "sendsay-docs" });
    expect(result.defaultBranch).toBeUndefined();
  });

  it.each(["Uppercase", "two words", "trailing-", "-leading"])(
    "rejects the project slug %s",
    (slug) => {
      expect(
        createProjectSchema.safeParse({
          connectionId: projectId,
          name: "Docs",
          repositoryProviderId: "group/docs",
          slug,
        }).success,
      ).toBe(false);
    },
  );

  it("accepts connection edits without requiring a replacement token", () => {
    expect(
      updateConnectionSchema.parse({
        baseUrl: "https://gitlab.internal.test",
        connectionId: "9d2c893f-8785-4b03-8568-e32655679be8",
        name: "Internal GitLab",
      }),
    ).toMatchObject({ token: "" });
    expect(
      deleteConnectionSchema.parse({
        confirmation: "Internal GitLab",
        connectionId: "9d2c893f-8785-4b03-8568-e32655679be8",
      }).confirmation,
    ).toBe("Internal GitLab");
  });

  it("validates editable project settings and guarded deletion", () => {
    expect(
      updateProjectSchema.parse({
        defaultBranch: "stable",
        name: "Sendsay Docs",
        projectId,
        rootPath: "website",
        slug: "sendsay-docs",
      }),
    ).toMatchObject({ defaultBranch: "stable", rootPath: "website" });
    expect(deleteProjectSchema.parse({ confirmation: "sendsay-docs", projectId }).projectId).toBe(
      projectId,
    );
    expect(
      updateProjectSchema.safeParse({
        defaultBranch: "stable",
        name: "Sendsay Docs",
        projectId,
        rootPath: ".",
        slug: "Invalid slug",
      }).success,
    ).toBe(false);
  });
});

describe("document commands", () => {
  it("parses a draft revision and permits an empty document", () => {
    expect(
      saveDraftSchema.parse({
        baseCommitSha: "abcdef0",
        branch: "docs/update",
        content: "",
        expectedRevision: 0,
        path: "docs/intro.mdx",
      }).expectedRevision,
    ).toBe(0);
  });

  it("rejects negative and fractional draft revisions", () => {
    const input = {
      baseCommitSha: "abcdef0",
      branch: "main",
      content: "text",
      path: "docs/intro.md",
    };
    expect(saveDraftSchema.safeParse({ ...input, expectedRevision: -1 }).success).toBe(false);
    expect(saveDraftSchema.safeParse({ ...input, expectedRevision: 1.5 }).success).toBe(false);
  });

  it("defaults a comment anchor to null and trims the body", () => {
    expect(
      createCommentSchema.parse({
        body: "  Проверить пример  ",
        branch: "main",
        documentPath: "a.md",
      }),
    ).toEqual({
      anchorQuote: null,
      body: "Проверить пример",
      branch: "main",
      documentPath: "a.md",
    });
  });

  it.each(["/docs/a.md", "docs/../a.md", "docs\\a.md", "docs/a.txt"])(
    "rejects the document path %s",
    (documentPath) => {
      expect(
        createDocumentSchema.safeParse({ branch: "main", path: documentPath, title: "Title" })
          .success,
      ).toBe(false);
    },
  );

  it("accepts Markdown and MDX document paths", () => {
    expect(createDocumentSchema.parse({ branch: "main", path: "docs/a.md", title: "A" }).path).toBe(
      "docs/a.md",
    );
    expect(
      createDocumentSchema.parse({ branch: "main", path: "versioned_docs/a.mdx", title: "A" }).path,
    ).toBe("versioned_docs/a.mdx");
  });
});

describe("review and membership commands", () => {
  it("normalizes an invitation email", () => {
    expect(inviteMemberSchema.parse({ email: "READER@EXAMPLE.TEST", role: "reader" })).toEqual({
      email: "reader@example.test",
      role: "reader",
    });
  });

  it("parses a guarded change set submission", () => {
    expect(
      submitChangeSetSchema.parse({
        branch: "docs/update",
        changeSetId,
        createReview: true,
        message: "Update documentation",
        projectId,
      }).createReview,
    ).toBe(true);
  });

  it.each(["ours", "theirs", "manual"])("accepts the %s conflict resolution", (resolution) => {
    expect(
      resolveConflictSchema.parse({
        conflictId: changeSetId,
        projectId,
        resolution,
        resolvedContent: resolution === "manual" ? "# Result" : "",
      }).resolution,
    ).toBe(resolution);
  });

  it("validates custom component names and supplies an empty description", () => {
    expect(
      createComponentSchema.parse({
        label: "Подсказка",
        name: "Docs.Callout",
        snippet: "<Docs.Callout />",
      }),
    ).toMatchObject({ description: "", name: "Docs.Callout" });
    expect(
      createComponentSchema.safeParse({ label: "bad", name: "docs-callout", snippet: "<Bad />" })
        .success,
    ).toBe(false);
  });
});
