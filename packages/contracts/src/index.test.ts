import { describe, expect, it } from "vitest";
import { createProjectSchema, resolveConflictSchema, submitChangeSetSchema } from "./index";

describe("public command schemas", () => {
  it("accepts a provider-verified project without duplicated repository metadata", () => {
    const result = createProjectSchema.parse({
      connectionId: "9d2c893f-8785-4b03-8568-e32655679be8",
      name: "Sendsay Docs",
      repositoryProviderId: "sendsay-ru/frontend/sendsay-docs",
      rootPath: ".",
      slug: "sendsay-docs",
    });
    expect(result.defaultBranch).toBeUndefined();
  });

  it("requires an explicit manual conflict result", () => {
    expect(() =>
      resolveConflictSchema.parse({
        conflictId: "not-a-uuid",
        projectId: "not-a-uuid",
        resolution: "manual",
        resolvedContent: "# Result",
      }),
    ).toThrow();
  });

  it("parses a guarded change-set submission", () => {
    expect(
      submitChangeSetSchema.parse({
        branch: "docs/update",
        changeSetId: "3532ba1e-d459-4d52-98af-27c958504046",
        createReview: true,
        message: "Update documentation",
        projectId: "3b63fe90-f569-4e0e-89e9-153948ba5a9e",
      }).createReview,
    ).toBe(true);
  });
});
