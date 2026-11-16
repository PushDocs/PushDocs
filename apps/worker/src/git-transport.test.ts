import { execFile } from "node:child_process";
import { chmod, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { BranchConflictChoice, BranchUpdateStrategy } from "@pushdocs/contracts";
import { afterEach, expect, it, vi } from "vitest";
import { GitTransport, type GitTransportProgress } from "./git-transport";

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
async function fixture(content = "# Original\n") {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pushdocs-git-test-"));
  directories.push(directory);
  const remote = path.join(directory, "remote.git");
  await exec("git", ["init", "--bare", "--initial-branch=main", remote]);
  await git(remote, "config", "uploadpack.allowFilter", "true");
  const source = path.join(directory, "source");
  await exec("git", ["clone", remote, source]);
  await writeFile(path.join(source, "article.md"), content);
  await git(source, "add", "article.md");
  await git(source, "commit", "-m", "Initial");
  await git(source, "push", "origin", "main");
  return { directory, remote, source, baseSha: await git(source, "rev-parse", "HEAD") };
}
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

const updateDate = "2026-11-13T10:00:00Z";
async function updateFixture() {
  const data = await fixture();
  await git(data.source, "branch", "docs/task");
  await writeFile(path.join(data.source, "upstream.md"), "Target branch content\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  const sourceSha = await git(data.source, "rev-parse", "HEAD");
  await git(data.source, "checkout", "docs/task");
  await writeFile(path.join(data.source, "article.md"), "# Changed by the author\n");
  await git(data.source, "add", ".");
  await git(
    data.source,
    "commit",
    "--author=Original Author <author@example.test>",
    "--date=2026-10-01T12:00:00+03:00",
    "-m",
    "Edit article\n\nKeep this message.",
  );
  const original = await git(data.source, "rev-parse", "HEAD");
  await git(data.source, "commit", "--allow-empty", "-m", "Keep an empty commit");
  await git(data.source, "push", "origin", "docs/task");
  const parentSha = await git(data.source, "rev-parse", "HEAD");
  const options = {
    directory: path.join(data.directory, "update"),
    remote: data.remote,
    allowLocal: true,
  };
  return { ...data, sourceSha, parentSha, original, options, transport: new GitTransport(options) };
}

it("rebases a linear branch, preserves author/messages and empty commits, and pushes only on request", async () => {
  const data = await updateFixture();
  const prepared = await data.transport.prepareUpdate({
    branch: "docs/task",
    sourceBranch: "main",
    strategy: BranchUpdateStrategy.Rebase,
    createdAt: updateDate,
  });
  expect(prepared.commits).toHaveLength(2);
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(data.parentSha);
  const first = prepared.commits[0]?.sha ?? "";
  expect(await git(data.options.directory, "rev-parse", `${first}^`)).toBe(data.sourceSha);
  expect(await git(data.options.directory, "show", `${prepared.sha}:upstream.md`)).toBe(
    "Target branch content",
  );
  expect(await git(data.options.directory, "show", `${prepared.sha}:article.md`)).toBe(
    "# Changed by the author",
  );
  expect(await git(data.options.directory, "show", "-s", "--format=%an%n%ae%n%aI%n%B", first)).toBe(
    await git(data.source, "show", "-s", "--format=%an%n%ae%n%aI%n%B", data.original),
  );
  expect(await git(data.options.directory, "show", "-s", "--format=%B", prepared.sha)).toBe(
    "Keep an empty commit",
  );
  expect(await git(data.options.directory, "rev-parse", "refs/pushdocs/update/original")).toBe(
    data.parentSha,
  );
  await data.transport.publish(prepared);
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(prepared.sha);
  expect(await git(data.remote, "rev-parse", "main")).toBe(data.sourceSha);
  expect(await data.transport.publish(prepared)).toEqual({
    sha: prepared.sha,
    alreadyApplied: true,
  });
});

it("reconstructs exactly the recorded rebase after its local cache is lost", async () => {
  const data = await updateFixture();
  const input = {
    branch: "docs/task",
    sourceBranch: "main",
    strategy: BranchUpdateStrategy.Rebase,
    createdAt: updateDate,
  };
  const prepared = await data.transport.prepareUpdate(input);
  await rm(data.options.directory, { recursive: true, force: true });
  const restored = new GitTransport(data.options);
  expect(await restored.prepareUpdate({ ...input, prepared })).toEqual(prepared);
  await restored.publish(prepared);
  await rm(data.options.directory, { recursive: true, force: true });
  expect(await new GitTransport(data.options).isPublished(prepared)).toBe(true);
});

it.each(["noop", "fast-forward"])("handles %s without rewriting existing commits", async (mode) => {
  const data = await fixture();
  if (mode === "fast-forward") await git(data.source, "branch", "docs/task");
  await writeFile(path.join(data.source, "upstream.md"), "Upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  if (mode === "noop") await git(data.source, "branch", "docs/task");
  await git(data.source, "push", "origin", "docs/task");
  const transport = new GitTransport({
    directory: path.join(data.directory, "update"),
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepareUpdate({
    branch: "docs/task",
    sourceBranch: "main",
    strategy: BranchUpdateStrategy.Rebase,
    createdAt: updateDate,
  });
  expect(prepared.commits).toEqual([]);
  expect(prepared.sha).toBe(await git(data.remote, "rev-parse", "main"));
});

it("stops a conflict on the second replayed commit without changing either remote branch", async () => {
  const data = await fixture();
  await git(data.source, "branch", "docs/task");
  await writeFile(path.join(data.source, "article.md"), "# Target\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Target");
  await git(data.source, "push", "origin", "main");
  const target = await git(data.source, "rev-parse", "HEAD");
  await git(data.source, "checkout", "docs/task");
  await writeFile(path.join(data.source, "first.md"), "Clean first commit\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "First");
  await writeFile(path.join(data.source, "article.md"), "# Source\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Second");
  await git(data.source, "push", "origin", "docs/task");
  const parent = await git(data.source, "rev-parse", "HEAD");
  const transport = new GitTransport({
    directory: path.join(data.directory, "update"),
    remote: data.remote,
    allowLocal: true,
  });
  await expect(
    transport.prepareUpdate({
      branch: "docs/task",
      sourceBranch: "main",
      strategy: BranchUpdateStrategy.Rebase,
      createdAt: updateDate,
    }),
  ).rejects.toThrow(`коммите ${parent.slice(0, 8)}: article.md`);
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(parent);
  expect(await git(data.remote, "rev-parse", "main")).toBe(target);
});

it("refuses a merge commit in the replay range before publishing", async () => {
  const data = await updateFixture();
  await git(data.source, "checkout", "-b", "side", data.baseSha);
  await writeFile(path.join(data.source, "side.md"), "Side branch\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Side");
  await git(data.source, "checkout", "docs/task");
  await git(data.source, "merge", "--no-ff", "side", "-m", "Merge side");
  await git(data.source, "push", "origin", "docs/task");
  const parent = await git(data.source, "rev-parse", "HEAD");
  await expect(
    data.transport.prepareUpdate({
      branch: "docs/task",
      sourceBranch: "main",
      strategy: BranchUpdateStrategy.Rebase,
      createdAt: updateDate,
    }),
  ).rejects.toThrow("merge-коммиты");
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(parent);
});

it("does not overwrite a concurrent source commit after preparing a rebase", async () => {
  const data = await updateFixture();
  const prepared = await data.transport.prepareUpdate({
    branch: "docs/task",
    sourceBranch: "main",
    strategy: BranchUpdateStrategy.Rebase,
    createdAt: updateDate,
  });
  await writeFile(path.join(data.source, "autofix.md"), "External commit\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Autofix");
  await git(data.source, "push", "origin", "docs/task");
  const external = await git(data.source, "rev-parse", "HEAD");
  await expect(data.transport.publish(prepared)).rejects.toThrow("обновилась перед отправкой");
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(external);
});

it("uses the merge strategy without rebasing GitHub-style behind branches", async () => {
  const data = await updateFixture();
  const prepared = await data.transport.prepareUpdate({
    branch: "docs/task",
    sourceBranch: "main",
    strategy: BranchUpdateStrategy.Merge,
    createdAt: updateDate,
  });
  expect(await git(data.options.directory, "show", "-s", "--format=%P", prepared.sha)).toBe(
    `${data.parentSha} ${data.sourceSha}`,
  );
  expect(prepared.commits).toEqual([]);
});

async function conflictFixture(
  ours: string | Uint8Array | null = "# Ours\n",
  theirs: string | Uint8Array = "# Theirs\n",
  filePath = "article.md",
  onProgress?: (progress: GitTransportProgress) => void,
  baseContent?: string,
) {
  const data = await fixture(baseContent);
  await git(data.source, "branch", "docs/task");
  await writeFile(path.join(data.source, filePath), theirs);
  await writeFile(path.join(data.source, "upstream.md"), "Clean upstream addition\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Target");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "checkout", "docs/task");
  if (ours === null) await git(data.source, "rm", filePath);
  else await writeFile(path.join(data.source, filePath), ours);
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Source");
  await git(data.source, "push", "origin", "docs/task");
  const transport = new GitTransport({
    directory: path.join(data.directory, "resolution"),
    remote: data.remote,
    allowLocal: true,
    onProgress,
  });
  if (onProgress) await git(data.remote, "config", "uploadpack.allowFilter", "true");
  const snapshot = await transport.inspectConflicts({ branch: "docs/task", sourceBranch: "main" });
  return { ...data, transport, snapshot };
}

it("counts received pack bytes, including lazy fetches, without exposing file contents", async () => {
  const progress: GitTransportProgress[] = [];
  await conflictFixture("# Ours\n", "# Theirs\n", "article.md", (value) => progress.push(value));
  const fetched = Math.max(
    ...progress
      .filter((item) => item.stage === "fetching-conflicts")
      .map((item) => item.transfer.receivedBytes),
  );
  expect(fetched).toBeGreaterThan(0);
  expect(
    progress.some(
      (item) => item.stage !== "fetching-conflicts" && item.transfer.receivedBytes > fetched,
    ),
  ).toBe(true);
  expect(
    progress.every(
      (item, index) =>
        item.transfer.receivedBytes >= (progress[index - 1]?.transfer.receivedBytes ?? 0),
    ),
  ).toBe(true);
  expect(progress.at(-1)?.counts).toEqual({ completed: 1, total: 1 });
  expect(progress.every((item) => item.transfer.totalBytes === null)).toBe(true);
  expect(JSON.stringify(progress)).not.toContain("# Original");
}, 15_000);

it.each([BranchConflictChoice.Ours, BranchConflictChoice.Theirs, BranchConflictChoice.Manual])(
  "resolves %s from a real merge tree, preserving clean changes and both parents",
  async (choice) => {
    const data = await conflictFixture();
    expect(data.snapshot.files).toEqual([
      expect.objectContaining({
        path: "article.md",
        kind: "text",
        oursContent: "# Ours\n",
        theirsContent: "# Theirs\n",
        baseContent: "# Original\n",
      }),
    ]);
    expect(data.snapshot.unsupportedReason).toBeUndefined();
    expect(await git(data.remote, "rev-parse", "docs/task")).toBe(data.snapshot.parentSha);
    const input = {
      branch: "docs/task",
      sourceBranch: "main",
      createdAt: "2026-11-13T00:00:00Z",
      resolution: {
        snapshot: data.snapshot,
        files: [{ path: "article.md", choice, content: "# Combined\n" }],
      },
    };
    const prepared = await data.transport.prepareMerge(input);
    await data.transport.publish(prepared);
    expect(await git(data.remote, "show", "docs/task:article.md")).toBe(
      choice === BranchConflictChoice.Ours
        ? "# Ours"
        : choice === BranchConflictChoice.Theirs
          ? "# Theirs"
          : "# Combined",
    );
    expect(await git(data.remote, "show", "docs/task:upstream.md")).toBe("Clean upstream addition");
    expect(await git(data.remote, "show", "-s", "--format=%P", "docs/task")).toBe(
      `${data.snapshot.parentSha} ${data.snapshot.sourceSha}`,
    );
    expect(await data.transport.isPublished(prepared)).toBe(true);
    const restored = new GitTransport({
      directory: path.join(data.directory, "recovered"),
      remote: data.remote,
      allowLocal: true,
    });
    expect((await restored.prepareMerge({ ...input, prepared })).sha).toBe(prepared.sha);
  },
  15_000,
);

it("extracts only conflicting fragments and preserves clean edits from both branches in a mixed result", async () => {
  const gap = Array.from({ length: 8 }, (_, index) => `Shared paragraph ${index}\n`).join("");
  const base = `Original intro\n${gap}First\n${gap}Second\n${gap}Original footer\n`;
  const ours = base
    .replace("Original intro", "Our intro")
    .replace("First", "Our first")
    .replace("Second", "Our second");
  const theirs = base
    .replace("Original footer", "Their footer")
    .replace("First", "Their first")
    .replace("Second", "Their second");
  const data = await conflictFixture(ours, theirs, "article.md", undefined, base);
  const sections = data.snapshot.files[0]?.sections;
  expect(sections?.filter((section) => section.kind === "conflict")).toEqual([
    { kind: "conflict", base: "First\n", ours: "Our first\n", theirs: "Their first\n" },
    { kind: "conflict", base: "Second\n", ours: "Our second\n", theirs: "Their second\n" },
  ]);
  let conflict = 0;
  const content = sections
    ?.map((section) =>
      section.kind === "text" ? section.content : conflict++ === 0 ? section.ours : section.theirs,
    )
    .join("");
  expect(content).toBe(`Our intro\n${gap}Our first\n${gap}Their second\n${gap}Their footer\n`);
  const prepared = await data.transport.prepareMerge({
    branch: "docs/task",
    sourceBranch: "main",
    createdAt: "2026-11-13T00:00:00Z",
    resolution: {
      snapshot: data.snapshot,
      files: [{ path: "article.md", choice: BranchConflictChoice.Manual, content }],
    },
  });
  await data.transport.publish(prepared);
  expect((await exec("git", ["-C", data.remote, "show", "docs/task:article.md"])).stdout).toBe(
    content,
  );
}, 15_000);

it.each(["\n", "\r\n", ""])(
  "preserves %j endings and literal conflict markers in fragment data",
  async (ending) => {
    const prefix = "<<<<<<< ours\n||||||| base\n=======\n>>>>>>> theirs\n\n";
    const data = await conflictFixture(
      `${prefix}Ours${ending}`,
      `${prefix}Theirs${ending}`,
      "article.md",
      undefined,
      `${prefix}Base${ending}`,
    );
    expect(data.snapshot.files[0]?.sections).toEqual([
      { kind: "text", content: prefix },
      { kind: "conflict", base: `Base${ending}`, ours: `Ours${ending}`, theirs: `Theirs${ending}` },
    ]);
  },
  15_000,
);

it("keeps deletion distinct from an empty manual result", async () => {
  const data = await conflictFixture(null);
  expect(data.snapshot.files[0]).toMatchObject({
    oursExists: false,
    theirsExists: true,
    kind: "text",
  });
  const prepared = await data.transport.prepareMerge({
    branch: "docs/task",
    sourceBranch: "main",
    createdAt: "2026-11-13T00:00:00Z",
    resolution: {
      snapshot: data.snapshot,
      files: [{ path: "article.md", choice: BranchConflictChoice.Ours }],
    },
  });
  await data.transport.publish(prepared);
  expect(await git(data.remote, "ls-tree", "docs/task", "article.md")).toBe("");
}, 15_000);

it("resolves add/add conflicts with Unicode and spaces in a path", async () => {
  const data = await conflictFixture("# Ours\n", "# Theirs\n", "new Ω file.md");
  expect(data.snapshot.files[0]).toMatchObject({
    path: "new Ω file.md",
    baseContent: null,
    kind: "text",
  });
  const prepared = await data.transport.prepareMerge({
    branch: "docs/task",
    sourceBranch: "main",
    createdAt: "2026-11-13T00:00:00Z",
    resolution: {
      snapshot: data.snapshot,
      files: [{ path: "new Ω file.md", choice: BranchConflictChoice.Theirs }],
    },
  });
  await data.transport.publish(prepared);
  expect(await git(data.remote, "show", "docs/task:new Ω file.md")).toBe("# Theirs");
}, 15_000);

it("shows rename conflicts but blocks their publication", async () => {
  const data = await fixture();
  await git(data.source, "branch", "docs/task");
  await git(data.source, "mv", "article.md", "target.md");
  await git(data.source, "commit", "-m", "Target rename");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "checkout", "docs/task");
  await git(data.source, "mv", "article.md", "ours.md");
  await git(data.source, "commit", "-m", "Source rename");
  await git(data.source, "push", "origin", "docs/task");
  const transport = new GitTransport({
    directory: path.join(data.directory, "rename"),
    remote: data.remote,
    allowLocal: true,
  });
  const snapshot = await transport.inspectConflicts({ branch: "docs/task", sourceBranch: "main" });
  expect(snapshot.unsupportedReason).toBeTruthy();
  expect(snapshot.files.length).toBeGreaterThan(0);
  await expect(
    transport.prepareMerge({
      branch: "docs/task",
      sourceBranch: "main",
      createdAt: "2026-11-13T00:00:00Z",
      resolution: { snapshot, files: [] },
    }),
  ).rejects.toThrow("Git-провайдере");
}, 15_000);

it("rejects non-UTF8 Git filenames instead of replacing them in the resolved tree", async () => {
  const data = await fixture();
  const gitInput = (args: string[], input: Buffer) =>
    new Promise<string>((resolve, reject) => {
      const child = execFile("git", ["-C", data.source, ...args], (error, stdout) =>
        error ? reject(error) : resolve(stdout.trim()),
      );
      child.stdin?.end(input);
    });
  const rawPath = Buffer.from([98, 97, 100, 45, 255, 46, 109, 100]);
  for (const branch of ["main", "docs/task"]) {
    const blob = await gitInput(["hash-object", "-w", "--stdin"], Buffer.from(branch));
    const tree = await gitInput(
      ["mktree", "-z"],
      Buffer.concat([Buffer.from(`100644 blob ${blob}\t`), rawPath, Buffer.from([0])]),
    );
    const commit = await git(
      data.source,
      "commit-tree",
      tree,
      "-p",
      data.baseSha,
      "-m",
      "Invalid filename fixture",
    );
    await git(data.source, "update-ref", `refs/heads/${branch}`, commit);
  }
  await git(data.source, "push", "origin", "main", "docs/task");
  const transport = new GitTransport({
    directory: path.join(data.directory, "encoding"),
    remote: data.remote,
    allowLocal: true,
  });
  await expect(
    transport.inspectConflicts({ branch: "docs/task", sourceBranch: "main" }),
  ).rejects.toThrow("кодировку");
}, 15_000);

it("resolves binary bytes by side and rejects manual binary results", async () => {
  const data = await conflictFixture(Buffer.from([0, 255, 1]), Buffer.from([0, 128, 2]));
  expect(data.snapshot.files[0]?.kind).toBe("binary");
  const input = { branch: "docs/task", sourceBranch: "main", createdAt: "2026-11-13T00:00:00Z" };
  await expect(
    data.transport.prepareMerge({
      ...input,
      resolution: {
        snapshot: data.snapshot,
        files: [{ path: "article.md", choice: BranchConflictChoice.Manual, content: "x" }],
      },
    }),
  ).rejects.toThrow("ручной");
  const prepared = await data.transport.prepareMerge({
    ...input,
    resolution: {
      snapshot: data.snapshot,
      files: [{ path: "article.md", choice: BranchConflictChoice.Theirs }],
    },
  });
  await data.transport.publish(prepared);
  expect(
    (await exec("git", ["-C", data.remote, "show", "docs/task:article.md"], { encoding: "buffer" }))
      .stdout,
  ).toEqual(Buffer.from([0, 128, 2]));
}, 15_000);

it("lists GIF and MP4 conflicts without downloading media blobs, then verifies the original trees before publishing", async () => {
  const data = await fixture();
  await git(data.remote, "config", "uploadpack.allowFilter", "true");
  const original = Buffer.alloc(128 * 1024, 1);
  original[0] = 0;
  const ours = Buffer.alloc(128 * 1024, 2);
  ours[0] = 0;
  const video = Buffer.alloc(128 * 1024, 3);
  video[0] = 0;
  await writeFile(path.join(data.source, "animation.gif"), original);
  await writeFile(path.join(data.source, "unchanged.mp4"), video);
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Media base");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "branch", "docs/task");
  const baseMedia = await git(data.source, "rev-parse", "HEAD:animation.gif");
  const unchangedMedia = await git(data.source, "rev-parse", "HEAD:unchanged.mp4");
  await writeFile(path.join(data.source, "animation.gif"), video);
  await writeFile(path.join(data.source, "animation.mp4"), video);
  await writeFile(path.join(data.source, "article.md"), "# Target\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Media migration");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "checkout", "docs/task");
  await writeFile(path.join(data.source, "animation.gif"), ours);
  await writeFile(path.join(data.source, "article.md"), "# Source\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Source changes");
  await git(data.source, "push", "origin", "docs/task");
  const oursMedia = await git(data.source, "rev-parse", "HEAD:animation.gif");
  const directory = path.join(data.directory, "media-preview");
  const transport = new GitTransport({ directory, remote: data.remote, allowLocal: true });
  const snapshot = await transport.inspectConflicts({ branch: "docs/task", sourceBranch: "main" });
  expect(snapshot.history).toMatchObject({
    branch: {
      sha: snapshot.parentSha,
      committedAt: await git(data.source, "show", "-s", "--format=%cI", snapshot.parentSha),
    },
    target: {
      sha: snapshot.sourceSha,
      committedAt: await git(data.source, "show", "-s", "--format=%cI", snapshot.sourceSha),
    },
  });
  expect(snapshot.mediaContentsSkipped).toBe(true);
  expect(snapshot.files.find((file) => file.path === "animation.gif")).toMatchObject({
    kind: "binary",
    oursExists: true,
    theirsExists: true,
    oursContent: null,
    theirsContent: null,
    versions: { ours: { sha: oursMedia } },
  });
  expect(snapshot.files.find((file) => file.path === "article.md")?.kind).toBe("text");
  const downloaded = await git(
    directory,
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname)",
  );
  for (const object of [baseMedia, unchangedMedia, oursMedia])
    expect(downloaded).not.toContain(object);
  const prepared = await transport.prepareMerge({
    branch: "docs/task",
    sourceBranch: "main",
    createdAt: "2026-11-13T00:00:00Z",
    resolution: {
      snapshot,
      files: snapshot.files.map((file) => ({ path: file.path, choice: BranchConflictChoice.Ours })),
    },
  });
  await transport.publish(prepared);
  expect(await git(data.remote, "rev-parse", "docs/task:animation.gif")).toBe(oursMedia);
  expect(await git(data.remote, "rev-parse", "docs/task:animation.mp4")).toBe(unchangedMedia);
}, 20_000);

it("finds article references to a deleted GIF inside a project root without fetching the GIF", async () => {
  const data = await fixture();
  await mkdir(path.join(data.source, "manual/docs"), { recursive: true });
  await mkdir(path.join(data.source, "manual/static/img"), { recursive: true });
  await writeFile(
    path.join(data.source, "manual/docs/a.md"),
    "# Article\n\n![Demo](../static/img/demo.gif)\n",
  );
  await writeFile(path.join(data.source, "manual/static/img/demo.gif"), Buffer.from([0, 1, 2]));
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Base with media");
  await git(data.source, "push", "origin", "main");
  const baseSha = await git(data.source, "rev-parse", "HEAD");
  await git(data.source, "branch", "docs/task");
  await git(data.source, "rm", "manual/static/img/demo.gif");
  await git(data.source, "commit", "-m", "Remove media");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "checkout", "docs/task");
  await writeFile(path.join(data.source, "manual/static/img/demo.gif"), Buffer.from([0, 3, 4]));
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Replace media");
  await git(data.source, "push", "origin", "docs/task");
  const directory = path.join(data.directory, "references");
  const snapshot = await new GitTransport({
    directory,
    remote: data.remote,
    allowLocal: true,
  }).inspectConflicts({ branch: "docs/task", sourceBranch: "main", rootPath: "manual" });
  expect(snapshot.history?.base.sha).toBe(baseSha);
  expect(snapshot.files[0]?.mediaReferences).toEqual({
    complete: true,
    articles: [
      { version: "branch", path: "manual/docs/a.md", title: "Article" },
      { version: "target", path: "manual/docs/a.md", title: "Article" },
    ],
  });
  const objects = await git(
    directory,
    "cat-file",
    "--batch-all-objects",
    "--batch-check=%(objectname)",
  );
  for (const ref of [baseSha, snapshot.parentSha])
    expect(objects).not.toContain(
      await git(data.source, "rev-parse", `${ref}:manual/static/img/demo.gif`),
    );
}, 20_000);

it("stops inspection before fetching blobs when the server does not advertise filtering", async () => {
  const data = await updateFixture();
  await git(data.remote, "config", "uploadpack.allowFilter", "false");
  const directory = path.join(data.directory, "unsupported-filter");
  await expect(
    new GitTransport({ directory, remote: data.remote, allowLocal: true }).inspectConflicts({
      branch: "docs/task",
      sourceBranch: "main",
    }),
  ).rejects.toThrow("до скачивания файлов");
  expect(
    await git(directory, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)"),
  ).toBe("");
}, 15_000);

it("rejects a different conflict version even when its path and branch tips match", async () => {
  const data = await conflictFixture();
  const file = data.snapshot.files[0];
  if (!file?.versions?.ours) throw new Error("Missing reviewed version");
  file.versions.ours.sha = "a".repeat(40);
  await expect(
    data.transport.prepareMerge({
      branch: "docs/task",
      sourceBranch: "main",
      createdAt: "2026-11-13T00:00:00Z",
      resolution: {
        snapshot: data.snapshot,
        files: [{ path: "article.md", choice: BranchConflictChoice.Ours }],
      },
    }),
  ).rejects.toThrow("другой конфликт");
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(data.snapshot.parentSha);
}, 15_000);

it("rejects stale inspections and incomplete decisions without changing remote branches", async () => {
  const data = await conflictFixture();
  const input = { branch: "docs/task", sourceBranch: "main", createdAt: "2026-11-13T00:00:00Z" };
  await expect(
    data.transport.prepareMerge({ ...input, resolution: { snapshot: data.snapshot, files: [] } }),
  ).rejects.toThrow("каждого");
  await writeFile(path.join(data.source, "new.md"), "Concurrent\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Concurrent");
  await git(data.source, "push", "origin", "docs/task");
  await expect(
    data.transport.prepareMerge({
      ...input,
      resolution: {
        snapshot: data.snapshot,
        files: [{ path: "article.md", choice: BranchConflictChoice.Ours }],
      },
    }),
  ).rejects.toThrow("обновились");
  expect(await git(data.remote, "show", "docs/task:new.md")).toBe("Concurrent");
}, 15_000);

it("prepares and pushes a text change without downloading unrelated binary blobs", async () => {
  const data = await fixture();
  await git(data.remote, "config", "uploadpack.allowFilter", "true");
  await writeFile(path.join(data.source, "large.bin"), Buffer.alloc(1024 * 1024, 7));
  await git(data.source, "add", "large.bin");
  await git(data.source, "commit", "-m", "Add media");
  await git(data.source, "push", "origin", "main");
  const binarySha = await git(data.source, "rev-parse", "HEAD:large.bin");
  const operation = path.join(data.directory, "filtered");
  const transport = new GitTransport({
    directory: operation,
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepare({
    branch: "main",
    baseSha: await git(data.source, "rev-parse", "HEAD"),
    operationId: "filtered",
    createdAt: "2026-09-15T00:00:00Z",
    message: "Edit text",
    changes: [{ path: "article.md", content: Buffer.from("# Updated\n"), operation: "update" }],
  });
  expect(
    await git(operation, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)"),
  ).not.toContain(binarySha);
  await transport.publish(prepared);
  expect(
    await git(operation, "cat-file", "--batch-all-objects", "--batch-check=%(objectname)"),
  ).not.toContain(binarySha);
  expect(await git(data.remote, "show", "main:article.md")).toBe("# Updated");
  expect(await git(data.remote, "rev-parse", "main:large.bin")).toBe(binarySha);
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

it("merges divergent branches, preserves both parents and retries without duplicate commits", async () => {
  const data = await fixture();
  await git(data.source, "checkout", "-b", "docs/task");
  await writeFile(path.join(data.source, "task.md"), "Task\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Task");
  const taskSha = await git(data.source, "rev-parse", "HEAD");
  await git(data.source, "push", "origin", "docs/task");
  await git(data.source, "checkout", "main");
  await writeFile(path.join(data.source, "article.md"), "# Upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  const upstream = await git(data.source, "rev-parse", "HEAD");
  const transport = new GitTransport({
    directory: path.join(data.directory, "merge"),
    remote: data.remote,
    allowLocal: true,
  });
  const input = { branch: "docs/task", sourceBranch: "main", createdAt: "2026-10-16T00:00:00Z" };
  const prepared = await transport.prepareMerge(input);
  await transport.publish(prepared);
  expect(await git(data.remote, "show", "docs/task:task.md")).toBe("Task");
  expect(await git(data.remote, "show", "docs/task:article.md")).toBe("# Upstream");
  expect(await git(data.remote, "show", "-s", "--format=%P", "docs/task")).toBe(
    `${taskSha} ${upstream}`,
  );
  expect(await git(data.remote, "rev-parse", "main")).toBe(upstream);
  const retried = await transport.prepareMerge(input);
  expect(retried.sha).toBe(prepared.sha);
  expect(await transport.publish(retried)).toMatchObject({ alreadyApplied: true });
});

it("fast-forwards a task branch and rejects conflicts without changing remote refs", async () => {
  const data = await fixture();
  await git(data.source, "branch", "docs/task");
  await git(data.source, "push", "origin", "docs/task");
  await writeFile(path.join(data.source, "article.md"), "# Upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  const upstream = await git(data.source, "rev-parse", "HEAD");
  const transport = new GitTransport({
    directory: path.join(data.directory, "merge"),
    remote: data.remote,
    allowLocal: true,
  });
  const input = { branch: "docs/task", sourceBranch: "main", createdAt: "2026-10-16T00:00:00Z" };
  const ff = await transport.prepareMerge(input);
  expect(ff.sha).toBe(upstream);
  await transport.publish(ff);
  // Create a fresh diverged task from the original base.
  await git(data.source, "checkout", "-b", "docs/conflict", data.baseSha);
  await writeFile(path.join(data.source, "article.md"), "# Task\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Conflict");
  await git(data.source, "push", "origin", "docs/conflict");
  const before = await git(data.remote, "rev-parse", "docs/conflict");
  await expect(transport.prepareMerge({ ...input, branch: "docs/conflict" })).rejects.toThrow(
    "конфликтующие",
  );
  expect(await git(data.remote, "rev-parse", "docs/conflict")).toBe(before);
  expect(await git(data.remote, "rev-parse", "main")).toBe(upstream);
});

it("refuses to publish a merge over a concurrent task update", async () => {
  const data = await fixture();
  await git(data.source, "branch", "docs/task");
  await git(data.source, "push", "origin", "docs/task");
  await writeFile(path.join(data.source, "upstream.md"), "Upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  const transport = new GitTransport({
    directory: path.join(data.directory, "merge"),
    remote: data.remote,
    allowLocal: true,
  });
  const prepared = await transport.prepareMerge({
    branch: "docs/task",
    sourceBranch: "main",
    createdAt: "2026-10-16T00:00:00Z",
  });
  await git(data.source, "checkout", "docs/task");
  await writeFile(path.join(data.source, "task.md"), "Concurrent\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Concurrent");
  await git(data.source, "push", "origin", "docs/task");
  await expect(transport.publish(prepared)).rejects.toMatchObject({ code: "PROVIDER_CONFLICT" });
  expect(await git(data.remote, "show", "docs/task:task.md")).toBe("Concurrent");
});

it("restores the original merge after an accepted push even when new upstream commits would conflict", async () => {
  const data = await fixture();
  await git(data.source, "checkout", "-b", "docs/task");
  await writeFile(path.join(data.source, "task.md"), "Task\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Task");
  await git(data.source, "push", "origin", "docs/task");
  await git(data.source, "checkout", "main");
  await writeFile(path.join(data.source, "article.md"), "# Upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Upstream");
  await git(data.source, "push", "origin", "main");
  const transport = new GitTransport({
    directory: path.join(data.directory, "first"),
    remote: data.remote,
    allowLocal: true,
  });
  const input = { branch: "docs/task", sourceBranch: "main", createdAt: "2026-10-16T00:00:00Z" };
  const prepared = await transport.prepareMerge(input);
  await transport.publish(prepared);
  // Simulate a lost acknowledgement/import failure, then independent edits on both branches.
  await writeFile(path.join(data.source, "article.md"), "# New upstream\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Later upstream");
  await git(data.source, "push", "origin", "main");
  await git(data.source, "fetch", "origin");
  await git(data.source, "checkout", "docs/task");
  await git(data.source, "reset", "--hard", "origin/docs/task");
  await writeFile(path.join(data.source, "article.md"), "# New task edit\n");
  await git(data.source, "add", ".");
  await git(data.source, "commit", "-m", "Later task edit");
  await git(data.source, "push", "origin", "docs/task");
  const before = await git(data.remote, "rev-parse", "docs/task");
  const restarted = new GitTransport({
    directory: path.join(data.directory, "empty-cache"),
    remote: data.remote,
    allowLocal: true,
  });
  await expect(restarted.prepareMerge(input)).rejects.toThrow("конфликтующие");
  const restored = await restarted.prepareMerge({ ...input, prepared });
  expect(restored).toEqual(prepared);
  expect(await restarted.publish(restored)).toMatchObject({ alreadyApplied: true });
  expect(await git(data.remote, "rev-parse", "docs/task")).toBe(before);
  expect(await git(data.remote, "show", "docs/task:article.md")).toBe("# New task edit");
});

it.each(["binary", "modify-delete", "file-directory"])(
  "leaves the remote unchanged for a %s conflict",
  async (kind) => {
    const data = await fixture();
    await git(data.source, "checkout", "-b", "docs/task");
    if (kind === "binary")
      await writeFile(path.join(data.source, "article.md"), Buffer.from([0, 1, 2]));
    else await writeFile(path.join(data.source, "article.md"), "# Task change\n");
    await git(data.source, "add", ".");
    await git(data.source, "commit", "-m", "Task");
    await git(data.source, "push", "origin", "docs/task");
    await git(data.source, "checkout", "main");
    if (kind === "binary")
      await writeFile(path.join(data.source, "article.md"), Buffer.from([0, 3, 4]));
    else {
      await git(data.source, "rm", "article.md");
      if (kind === "file-directory") {
        const { mkdir } = await import("node:fs/promises");
        await mkdir(path.join(data.source, "article.md"));
        await writeFile(path.join(data.source, "article.md", "child.md"), "# Nested\n");
      }
    }
    await git(data.source, "add", ".");
    await git(data.source, "commit", "-m", "Conflicting upstream");
    await git(data.source, "push", "origin", "main");
    const before = await git(data.remote, "rev-parse", "docs/task");
    const transport = new GitTransport({
      directory: path.join(data.directory, "merge"),
      remote: data.remote,
      allowLocal: true,
    });
    await expect(
      transport.prepareMerge({
        branch: "docs/task",
        sourceBranch: "main",
        createdAt: "2026-10-16T00:00:00Z",
      }),
    ).rejects.toThrow("конфликтующие");
    expect(await git(data.remote, "rev-parse", "docs/task")).toBe(before);
  },
);
