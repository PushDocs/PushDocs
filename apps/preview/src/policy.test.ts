import { expect, it } from "vitest";
import {
  containerArguments,
  expiredPreviewIds,
  previewToken,
  resolveRuntime,
  snapshotFiles,
  verifyPreviewToken,
} from "./policy";

it("expires old preview outputs and keeps recent successes isolated by project and branch", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const rows = [
    ...Array.from({ length: 4 }, (_, index) => ({
      id: `ready-${index}`,
      projectId: "a",
      branch: "main",
      status: "ready",
      createdAt: new Date(now.getTime() - index * 1000),
    })),
    { id: "other-project", projectId: "b", branch: "main", status: "ready", createdAt: now },
    { id: "other-branch", projectId: "a", branch: "work", status: "ready", createdAt: now },
    {
      id: "old",
      projectId: "a",
      branch: "old",
      status: "failed",
      createdAt: new Date("2026-08-01"),
    },
    {
      id: "running",
      projectId: "a",
      branch: "main",
      status: "building",
      createdAt: new Date("2026-08-01"),
    },
  ];
  expect(expiredPreviewIds(rows, now)).toEqual(["ready-3", "old"]);
});

it("selects only operator-approved runtimes and keeps private dependency caches scoped to a project", () => {
  const profiles = JSON.stringify({
    private: {
      image: "docs-private:1",
      projects: ["project-a"],
      memoryMiB: 2048,
      cpus: 1,
      timeoutSeconds: 300,
    },
  });
  const runtime = resolveRuntime("project-a", "private", profiles, "public:1");
  expect(runtime).toEqual({
    image: "docs-private:1",
    memoryMiB: 2048,
    cpus: 1,
    timeoutSeconds: 300,
  });
  expect(() => resolveRuntime("project-b", "private", profiles, "public:1")).toThrow(
    "not available",
  );
  expect(() => resolveRuntime("project-a", "unlisted", profiles, "public:1")).toThrow(
    "not available",
  );
  expect(
    containerArguments(
      "e8a3986f-ccdb-4d7f-aa40-4d9675a98432",
      runtime.image,
      "volume",
      undefined,
      runtime,
    ),
  ).toContain("--memory=2048m");
  expect(resolveRuntime("project-b", "default", undefined, "public:1").image).toBe("public:1");
});
it("rejects invalid runtime limits and accepts an explicitly public cache", () => {
  for (const invalid of [
    { image: "--privileged" },
    { memoryMiB: 0 },
    { memoryMiB: 16385 },
    { cpus: 0 },
    { cpus: 9 },
    { timeoutSeconds: 1 },
    { timeoutSeconds: 1801 },
  ]) {
    expect(() =>
      resolveRuntime(
        "p",
        "test",
        JSON.stringify({ test: { projects: ["p"], image: "runtime:1", ...invalid } }),
      ),
    ).toThrow("limits");
  }
  expect(
    resolveRuntime(
      "p",
      "public",
      JSON.stringify({ public: { projects: ["*"], image: "runtime:1" } }),
    ),
  ).toEqual({ image: "runtime:1", memoryMiB: 4096, cpus: 2, timeoutSeconds: 900 });
  expect(() => resolveRuntime("p", "default")).toThrow("not available");
  expect(() => resolveRuntime("p", "invalid", JSON.stringify({ invalid: { image: "x" } }))).toThrow(
    "not available",
  );
});

it("isolates code from the network, host secrets and sibling previews", () => {
  const args = containerArguments(
    "e8a3986f-ccdb-4d7f-aa40-4d9675a98432",
    "runtime:1",
    "pushdocs_previews",
  );
  expect(args).toContain("--network=none");
  expect(args).toContain("--read-only");
  expect(args).toContain("--cap-drop=ALL");
  expect(args).toContain("--pids-limit=256");
  expect(args.join(" ")).not.toContain("docker.sock");
  expect(args.join(" ")).not.toContain("DATABASE_URL");
  expect(args.filter((arg) => arg.includes("volume-subpath="))).toHaveLength(3);
});
it("does not accept arbitrary mount or container names", () => {
  expect(() => containerArguments("../../x", "runtime:1", "volume")).toThrow();
  expect(() =>
    containerArguments("e8a3986f-ccdb-4d7f-aa40-4d9675a98432", "runtime:1", "volume,dst=/etc"),
  ).toThrow();
});
it("binds preview grants to their build and expiry", () => {
  const token = previewToken("secret", "build", 200);
  expect(verifyPreviewToken("secret", "build", "200", token, 100)).toBe(true);
  expect(verifyPreviewToken("secret", "other", "200", token, 100)).toBe(false);
  expect(verifyPreviewToken("secret", "build", "200", token, 201)).toBe(false);
  expect(verifyPreviewToken("secret", "build", "200", "x", 100)).toBe(false);
});
it("overlays changed and deleted files without altering the Git snapshot", () => {
  const base = new Map([
    ["docs/a.md", Buffer.from("old")],
    ["docs/b.md", Buffer.from("b")],
  ]);
  const output = snapshotFiles(base, [
    { path: "docs/a.md", content: "new" },
    { path: "docs/b.md", content: null },
  ]);
  expect(Buffer.from(output.get("docs/a.md") ?? []).toString()).toBe("new");
  expect(output.has("docs/b.md")).toBe(false);
  expect(base.get("docs/a.md")?.toString()).toBe("old");
  expect(() => snapshotFiles(base, [{ path: "../escape", content: "bad" }])).toThrow();
});

it("validates local bind paths and rejects oversized snapshots", () => {
  const id = "e8a3986f-ccdb-4d7f-aa40-4d9675a98432";
  for (const directory of ["relative", "/tmp,bad", "/tmp\nbad", "/tmp/../etc"])
    expect(() => containerArguments(id, "runtime:1", "volume", directory)).toThrow(
      "host directory",
    );
  expect(containerArguments(id, "runtime:1", "volume", "/tmp/previews").join(" ")).toContain(
    `type=bind,src=/tmp/previews/${id}/input,dst=/input,readonly`,
  );
  expect(() => containerArguments(id, "--privileged", "volume")).toThrow();
  expect(() =>
    snapshotFiles(new Map([["large", new Uint8Array(256 * 1024 * 1024 + 1)]]), []),
  ).toThrow("256 MiB");
  expect(verifyPreviewToken("key", id, "invalid", "token")).toBe(false);
});
