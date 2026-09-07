import type { CheckRunSummary, ProjectRole } from "@pushdocs/contracts";
import { describe, expect, it } from "vitest";
import {
  AccessDeniedError,
  assertCan,
  can,
  evaluateMergeReadiness,
  normalizeBranchRef,
  type ProjectAction,
} from "./index";

const actions: ProjectAction[] = [
  "project:read",
  "comment:create",
  "comment:moderate",
  "document:write",
  "branch:push",
  "change-request:create",
  "change-request:merge",
  "member:manage",
  "project:configure",
];

const expectedPermissions: Record<ProjectRole, ProjectAction[]> = {
  admin: actions,
  editor: [
    "project:read",
    "comment:create",
    "document:write",
    "branch:push",
    "change-request:create",
  ],
  reader: ["project:read", "comment:create"],
};

const rolePermissions = Object.entries(expectedPermissions) as Array<
  [ProjectRole, ProjectAction[]]
>;

describe("project access", () => {
  it.each(rolePermissions)("defines every permission for %s", (role, allowed) => {
    expect(actions.filter((action) => can(role, action))).toEqual(allowed);
  });

  it("throws a typed error with the denied action", () => {
    expect(() => assertCan("reader", "document:write")).toThrow(AccessDeniedError);
    try {
      assertCan("reader", "document:write");
    } catch (error) {
      expect(error).toMatchObject({
        code: "ACCESS_DENIED",
        message: "The project role does not allow document:write",
      });
    }
  });

  it("does not throw for an allowed action", () => {
    expect(() => assertCan("editor", "branch:push")).not.toThrow();
  });
});

describe("branch references", () => {
  it.each([
    [" docs/mcp-guide ", "docs/mcp-guide"],
    ["main", "main"],
    ["release-2026.09", "release-2026.09"],
    ["feature_1", "feature_1"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizeBranchRef(input)).toBe(expected);
  });

  it.each([
    "",
    "../stable",
    "docs branch",
    "/main",
    "main/",
    "main.",
    "topic@{1}",
    "bad~name",
    "bad^name",
    "bad:name",
    "bad?name",
    "bad*name",
    "bad[name",
    "bad\\name",
    `bad${String.fromCharCode(127)}name`,
    "a".repeat(256),
  ])("rejects %s", (branch) => {
    expect(() => normalizeBranchRef(branch)).toThrow("Invalid Git branch name");
  });
});

function check(
  conclusion: CheckRunSummary["conclusion"],
  required = true,
  id: string = conclusion,
): CheckRunSummary {
  return { conclusion, durationMs: null, id, name: id, required, url: null };
}

describe("merge readiness", () => {
  it("is ready when every required check passed or was skipped", () => {
    expect(evaluateMergeReadiness([check("success"), check("skipped")])).toEqual({
      blockingFailures: [],
      pending: [],
      ready: true,
    });
  });

  it("reports required failures and running checks separately", () => {
    const failure = check("failure", true, "test");
    const running = check("running", true, "build");
    expect(evaluateMergeReadiness([failure, running, check("neutral")])).toEqual({
      blockingFailures: [failure],
      pending: [running],
      ready: false,
    });
  });

  it("ignores optional failures and running checks", () => {
    expect(evaluateMergeReadiness([check("failure", false), check("running", false)])).toEqual({
      blockingFailures: [],
      pending: [],
      ready: true,
    });
  });
});
