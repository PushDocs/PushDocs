import { execFile } from "node:child_process";
import { chmod, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, expect, it, vi } from "vitest";
import { GitTransport } from "./git-transport";

const exec = promisify(execFile);
const directories: string[] = [];
async function git(directory: string, ...args: string[]) {
  return (
    await exec("git", ["-C", directory, ...args], {
      env: {
        ...process.env,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_CONFIG_SYSTEM: "/dev/null",
        GIT_AUTHOR_NAME: "Fixture",
        GIT_AUTHOR_EMAIL: "fixture@example.test",
        GIT_COMMITTER_NAME: "Fixture",
        GIT_COMMITTER_EMAIL: "fixture@example.test",
        GIT_TERMINAL_PROMPT: "0",
      },
    })
  ).stdout.trim();
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-git-test-"));
  directories.push(directory);
  const remote = path.join(directory, "remote.git");
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  const source = path.join(directory, "source");
  await exec("git", ["clone", remote, source]);
  await writeFile(path.join(source, "article.md"), "# Original\n");
  await git(source, "add", "article.md");
  await git(source, "commit", "-m", "Initial");
  await git(source, "push", "origin", "main");
  return { directory, remote, source, baseSha: await git(source, "rev-parse", "HEAD") };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

it("rejects a prepared write if another author advances the remote ref", async () => {
  const data = await fixture();
  const transport = new GitTransport({
    directory: path.join(data.directory, "operation"),
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepare({
    branch: "main",
    baseSha: data.baseSha,
    operationId: "operation-1",
    createdAt: "2026-09-08T00:00:00Z",
    message: "Edit article",
    changes: [{ path: "article.md", content: Buffer.from("# Ours\n"), operation: "update" }],
  });
  await writeFile(path.join(data.source, "other.md"), "Another author's document\n");
  await git(data.source, "add", "other.md");
  await git(data.source, "commit", "-m", "Concurrent edit");
  await git(data.source, "push", "origin", "main");
  const theirs = await git(data.source, "rev-parse", "HEAD");
  await expect(transport.publish(prepared)).rejects.toMatchObject({ code: "PROVIDER_CONFLICT" });
  expect(await git(data.remote, "rev-parse", "refs/heads/main")).toBe(theirs);
  expect(await git(data.remote, "show", "main:article.md")).toBe("# Original");
});

it("recovers an acknowledged or interrupted write without another commit, including a later autofix", async () => {
  const data = await fixture();
  const input = {
    branch: "main",
    baseSha: data.baseSha,
    operationId: "operation-2",
    createdAt: "2026-09-08T00:00:00Z",
    message: "Add binary",
    changes: [
      { path: "image.bin", content: Buffer.from([0, 255, 128, 10]), operation: "create" as const },
    ],
  };
  const transport = new GitTransport({
    directory: path.join(data.directory, "operation"),
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepare(input);
  expect(await transport.publish(prepared)).toEqual({ sha: prepared.sha, alreadyApplied: false });
  const restarted = new GitTransport({
    directory: path.join(data.directory, "restarted"),
    remote: data.remote,
    allowLocal: true,
  });
  const restored = await restarted.prepare(input);
  expect(restored.sha).toBe(prepared.sha);
  expect(await restarted.publish(restored)).toEqual({ sha: prepared.sha, alreadyApplied: true });
  await git(data.source, "pull", "--ff-only");
  await writeFile(path.join(data.source, "autofix.md"), "Formatted\n");
  await git(data.source, "add", "autofix.md");
  await git(data.source, "commit", "-m", "Autofix");
  await git(data.source, "push", "origin", "main");
  expect(await restarted.publish(restored)).toEqual({ sha: prepared.sha, alreadyApplied: true });
  expect(await git(data.remote, "rev-list", "--count", "main")).toBe("3");
  const binary = await exec("git", ["-C", data.remote, "show", "main:image.bin"], {
    encoding: "buffer",
  });
  expect(binary.stdout).toEqual(Buffer.from([0, 255, 128, 10]));
});

it("does not create a commit when the intended bytes already exist upstream", async () => {
  const data = await fixture();
  const transport = new GitTransport({
    directory: path.join(data.directory, "noop"),
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepare({
    branch: "main",
    baseSha: data.baseSha,
    operationId: "noop",
    createdAt: "2026-09-08T00:00:00Z",
    message: "No-op",
    changes: [{ path: "article.md", operation: "update", content: Buffer.from("# Original\n") }],
  });
  expect(prepared.sha).toBe(data.baseSha);
  await transport.publish(prepared);
  expect(await git(data.remote, "rev-list", "--count", "main")).toBe("1");
});

it("allows only one of two concurrent writers to publish against the same parent", async () => {
  const data = await fixture();
  const transports = ["first", "second"].map(
    (name) =>
      new GitTransport({
        directory: path.join(data.directory, name),
        remote: data.remote,
        allowLocal: true,
      }),
  );
  const prepared = await Promise.all(
    transports.map((transport, index) =>
      transport.prepare({
        branch: "main",
        baseSha: data.baseSha,
        operationId: `race-${index}`,
        createdAt: "2026-09-08T00:00:00Z",
        message: "Race",
        changes: [
          { path: "article.md", operation: "update", content: Buffer.from(`Writer ${index}`) },
        ],
      }),
    ),
  );
  const results = await Promise.allSettled(
    transports.map((transport, index) => transport.publish(prepared[index]!)),
  );
  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(await git(data.remote, "rev-list", "--count", "main")).toBe("2");
});

it("preserves executable modes and handles a file-to-directory replacement atomically", async () => {
  const data = await fixture();
  await writeFile(path.join(data.source, "script.sh"), "#!/bin/sh\nexit 0\n");
  await chmod(path.join(data.source, "script.sh"), 0o755);
  await symlink("article.md", path.join(data.source, "link.md"));
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Modes");
  await git(data.source, "push", "origin", "main");
  const baseSha = await git(data.source, "rev-parse", "HEAD");
  const transport = new GitTransport({
    directory: path.join(data.directory, "modes"),
    remote: data.remote,
    allowLocal: true,
  });
  const input = {
    branch: "main",
    baseSha,
    operationId: "modes",
    createdAt: "2026-09-08T00:00:00Z",
    message: "Move",
  };
  await expect(
    transport.prepare({
      ...input,
      changes: [{ path: "link.md", operation: "update", content: Buffer.from("bad") }],
    }),
  ).rejects.toThrow("symlinks");
  await expect(
    transport.prepare({
      ...input,
      changes: [{ path: "article.md", operation: "create", content: Buffer.from("bad") }],
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_CONFLICT" });
  await expect(
    transport.prepare({
      ...input,
      changes: [{ path: "missing.md", operation: "delete", content: null }],
    }),
  ).rejects.toMatchObject({ code: "PROVIDER_CONFLICT" });
  await expect(
    transport.prepare({
      ...input,
      changes: [{ path: "article.md", operation: "update", content: null }],
    }),
  ).rejects.toThrow("Missing Git file bytes");
  const prepared = await transport.prepare({
    ...input,
    changes: [
      {
        path: "article.md/intro.mdx",
        operation: "create",
        content: Buffer.from("# Moved\r\n<Thing />\r\n"),
      },
      { path: "article.md", operation: "delete", content: null },
      { path: "script.sh", operation: "update", content: Buffer.from("#!/bin/sh\nexit 1\n") },
    ],
  });
  await transport.publish(prepared);
  expect(await git(data.remote, "ls-tree", "main", "script.sh")).toMatch(/^100755 blob/);
  expect(
    (
      await exec("git", ["-C", data.remote, "show", "main:article.md/intro.mdx"], {
        encoding: "buffer",
      })
    ).stdout,
  ).toEqual(Buffer.from("# Moved\r\n<Thing />\r\n"));
});

it("rejects unsafe transport options and invalid commit inputs before writing", async () => {
  expect(() => new GitTransport({ directory: "/", remote: "https://example.test/repo" })).toThrow(
    "dedicated",
  );
  expect(
    () => new GitTransport({ directory: "relative", remote: "https://example.test/repo" }),
  ).toThrow("dedicated");
  for (const remote of [
    "file:///tmp/repo",
    "ssh://example.test/repo",
    "https://user:token@example.test/repo",
  ])
    expect(() => new GitTransport({ directory: "/tmp/unused-pushdocs-fixture", remote })).toThrow(
      "HTTP(S)",
    );
  const transport = new GitTransport({
    directory: "/tmp/unused-pushdocs-fixture",
    remote: "https://example.test/repo",
  });
  const input = {
    branch: "main",
    baseSha: "a".repeat(40),
    operationId: "valid",
    createdAt: "2026-09-08T00:00:00Z",
    message: "Valid",
    changes: [],
  };
  await expect(transport.prepare({ ...input, baseSha: "--help" })).rejects.toThrow("object id");
  await expect(transport.prepare({ ...input, operationId: "bad\nidentity" })).rejects.toThrow(
    "identity",
  );
  await expect(transport.prepare({ ...input, createdAt: "invalid" })).rejects.toThrow("identity");
  await expect(
    transport.prepare({
      ...input,
      changes: [
        { path: "same", operation: "delete", content: null },
        { path: "same", operation: "delete", content: null },
      ],
    }),
  ).rejects.toThrow("Duplicate");
  for (const filePath of [
    "",
    "/etc/passwd",
    "../out",
    ".git/config",
    "a\\b",
    "a\u0000b",
    "a//b",
    "./a",
    "a\u007fb",
  ])
    await expect(
      transport.prepare({
        ...input,
        changes: [{ path: filePath, operation: "delete", content: null }],
      }),
    ).rejects.toThrow("path");
});

it("reports a missing Git executable without exposing the authorization header", async () => {
  const data = await fixture();
  vi.stubEnv("PATH", "");
  const transport = new GitTransport({
    directory: path.join(data.directory, "missing-git"),
    remote: data.remote,
    allowLocal: true,
    authorization: "Authorization: Basic Zml4dHVyZTpzZWNyZXQ=",
  });
  await expect(transport.head("main")).rejects.toThrow(/ENOENT/);
});

it("honors a server-side protected branch rejection", async () => {
  const data = await fixture();
  await writeFile(
    path.join(data.remote, "hooks", "pre-receive"),
    "#!/bin/sh\necho 'Protected branch: rejected' >&2\nexit 1\n",
    { mode: 0o755 },
  );
  const transport = new GitTransport({
    directory: path.join(data.directory, "protected"),
    remote: data.remote,
    allowLocal: true,
    authorization: "Authorization: Basic Zml4dHVyZTpzZWNyZXQ=",
  });
  const prepared = await transport.prepare({
    branch: "main",
    baseSha: data.baseSha,
    operationId: "protected",
    createdAt: "2026-09-08T00:00:00Z",
    message: "Edit",
    changes: [{ path: "article.md", operation: "update", content: Buffer.from("# Edit") }],
  });
  await expect(transport.publish(prepared)).rejects.toThrow(/Protected branch/);
  expect(await git(data.remote, "rev-parse", "refs/heads/main")).toBe(data.baseSha);
  await writeFile(
    path.join(data.remote, "hooks", "pre-receive"),
    "#!/bin/sh\necho 'stale info' >&2\nexit 1\n",
    { mode: 0o755 },
  );
  await expect(transport.publish(prepared)).rejects.toMatchObject({ code: "PROVIDER_CONFLICT" });
});

it("terminates a Git command that exceeds its deadline", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-git-deadline-"));
  directories.push(directory);
  await writeFile(path.join(directory, "git"), "#!/bin/sh\nexec /bin/sleep 20\n", { mode: 0o755 });
  vi.stubEnv("PATH", directory);
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  try {
    const transport = new GitTransport({
      directory: path.join(directory, "operation"),
      remote: "https://unused.invalid/repo",
    });
    const result = expect(transport.head("main")).rejects.toThrow("Git init failed");
    while (vi.getTimerCount() === 0) await new Promise<void>((resolve) => setImmediate(resolve));
    await vi.advanceTimersByTimeAsync(120_000);
    await result;
  } finally {
    vi.useRealTimers();
  }
});
