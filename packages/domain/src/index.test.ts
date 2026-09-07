import { describe, expect, it } from "vitest";
import { assertCan, can, evaluateMergeReadiness, normalizeBranchRef } from "./index";

describe("project access", () => {
  it("lets readers comment without writing documents", () => {
    expect(can("reader", "comment:create")).toBe(true);
    expect(can("reader", "document:write")).toBe(false);
    expect(() => assertCan("reader", "document:write")).toThrow("document:write");
  });

  it("keeps merge rights with project administrators", () => {
    expect(can("editor", "change-request:merge")).toBe(false);
    expect(can("admin", "change-request:merge")).toBe(true);
  });
});

describe("branch references", () => {
  it("accepts a nested working branch", () => {
    expect(normalizeBranchRef(" docs/mcp-guide ")).toBe("docs/mcp-guide");
  });

  it.each(["", "../stable", "docs branch", "/main", "main.lock."])("rejects %s", (branch) => {
    expect(() => normalizeBranchRef(branch)).toThrow();
  });
});

describe("merge readiness", () => {
  it("does not block on an optional failure", () => {
    expect(
      evaluateMergeReadiness([
        {
          conclusion: "failure",
          durationMs: 10,
          id: "one",
          name: "preview",
          required: false,
          url: null,
        },
      ]).ready,
    ).toBe(true);
  });
});
