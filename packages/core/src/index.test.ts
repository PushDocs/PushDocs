import { describe, expect, it, vi } from "vitest";
import { type CoreRepository, PushDocs } from "./index";

function repository(): CoreRepository {
  return {
    createComment: vi.fn(),
    createConnection: vi.fn(),
    createInvitation: vi.fn(),
    createProject: vi.fn(),
    listDocuments: vi.fn().mockResolvedValue([]),
    listProjects: vi.fn().mockResolvedValue([]),
    requireProjectAccess: vi.fn().mockResolvedValue({ role: "editor" }),
    saveDraft: vi.fn().mockResolvedValue({ changeSetId: "change", revision: 2 }),
  };
}

describe("PushDocs", () => {
  it("checks project membership before listing documents", async () => {
    const port = repository();
    const app = new PushDocs(port);
    await app.listDocuments({ id: "user", isInstanceOperator: false }, "project", "main");
    expect(port.requireProjectAccess).toHaveBeenCalledWith("user", "project", "project:read");
  });

  it("keeps installation management separate from project roles", () => {
    const app = new PushDocs(repository());
    expect(() =>
      app.createConnection(
        { id: "admin", isInstanceOperator: false },
        {
          baseUrl: "https://git.example.test",
          kind: "gitlab",
          name: "GitLab",
          secretEncrypted: "secret",
        },
      ),
    ).toThrow("INSTANCE_OPERATOR_REQUIRED");
  });
});
