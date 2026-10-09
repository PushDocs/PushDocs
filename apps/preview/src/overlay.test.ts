import { execFile } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";
import { expect, it, vi } from "vitest";
import { createPreviewService } from "./service";
import { workspaceKey } from "./workspaces";

const launches = vi.hoisted(() => [] as string[][]);

vi.mock("node:child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:child_process")>();
  return {
    ...original,
    spawn: (command: string, args: string[], options: unknown) => {
      launches.push([command, ...args]);
      if (command === "git") return original.spawn(command, args, options as never);
      const child = Object.assign(new EventEmitter(), {
        exitCode: null,
        signalCode: null,
        stdout: new PassThrough(),
        stderr: new PassThrough(),
      });
      if (command !== "fixture" || !args.includes("start"))
        queueMicrotask(() => child.emit("close", 0));
      return child;
    },
  };
});

it("updates only changed files, preserves dependencies across commits and reinstalls changed manifests", async () => {
  launches.length = 0;
  const root = await mkdtemp(path.join(tmpdir(), "pushdocs-overlay-"));
  const id = "00000000-0000-4000-8000-000000000001";
  const workspace = path.join(root, id);
  const git = promisify(execFile);
  const session = {
    id,
    project_id: "00000000-0000-4000-8000-000000000002",
    branch: "stable",
    port: 43000,
    desired_state: "running",
    status: "queued",
    updated_at: new Date(),
    log: "",
  };
  const sessions = [session];
  const backgroundBranches: Array<{
    project_id: string;
    full_ref: string;
    default_branch: string;
    head_commit_sha: string;
  }> = [];
  let revision = 1;
  let preview: ReturnType<typeof createPreviewService> | undefined;
  try {
    await mkdir(path.join(workspace, ".pushdocs"), { recursive: true });
    await writeFile(path.join(workspace, "base.txt"), "base");
    await writeFile(
      path.join(workspace, ".pushdocs/config.json"),
      JSON.stringify({
        version: 1,
        preview: { install: ["fixture", "install"], start: ["fixture", "start"], output: "build" },
      }),
    );
    await git("git", ["init", "--quiet", workspace]);
    await git("git", ["-C", workspace, "add", "."]);
    await git("git", [
      "-C",
      workspace,
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "--quiet",
      "-m",
      "base",
    ]);
    let head = (await git("git", ["-C", workspace, "rev-parse", "HEAD"])).stdout.trim();
    const remote = path.join(root, "remote.git");
    await git("git", ["clone", "--bare", "--quiet", workspace, remote]);
    await writeFile(
      path.join(root, `${id}.json`),
      JSON.stringify({ appliedPaths: [], headSha: head, installed: true, uid: 11000 }),
    );
    await writeFile(path.join(root, "attachment"), "image");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("ready")),
    );
    preview = createPreviewService({
      workspaceRoot: root,
      attachmentsRoot: root,
      gitAccess: async () => ({ remote, env: process.env }),
      repository: {
        reconcilePreviewLeases: async () => undefined,
        listPreviewSessions: async () => sessions,
        listPreviewWorkspaces: async () => backgroundBranches,
        getProjectSyncTarget: async () => ({
          root_path: ".",
          clone_url: "https://example.test/repo.git",
          base_url: "https://example.test",
          kind: "github",
          secret_encrypted: "token",
        }),
        listChangedWorkingFiles: async () => ({
          branch: { head_commit_sha: head },
          changeSet: { revision },
          files: [
            { path: "docs/unchanged.md", content: "unchanged", status: "add" },
            { path: "docs/edited.md", content: `revision ${revision}`, status: "add" },
          ],
        }),
        listPreviewAttachments: async () => [
          { repository_path: "static/image.png", storage_key: "attachment" },
        ],
        updatePreviewSession: async (id: string, values: object) =>
          Object.assign(sessions.find((item) => item.id === id) ?? {}, values),
      } as never,
      decryptSecret: (value) => value,
    });
    await preview.tick();
    await vi.waitFor(() => expect(session.status).toBe("ready"));
    // Locate the workspace through its article, also after migration to a stable branch path.
    const { readdir } = await import("node:fs/promises");
    const entries = await readdir(root, { recursive: true });
    const article = entries.find((entry) => entry.endsWith("docs/unchanged.md"));
    if (!article) throw new Error("Preview article is missing");
    const currentWorkspace = path.dirname(path.dirname(path.join(root, article)));
    const paths = ["docs/unchanged.md", "static/image.png"].map((file) =>
      path.join(currentWorkspace, file),
    );
    const oldTime = new Date("2020-01-01T00:00:00Z");
    for (const file of paths) await utimes(file, oldTime, oldTime);
    revision++;
    await preview.tick();
    expect(await readFile(path.join(currentWorkspace, "docs/edited.md"), "utf8")).toBe(
      "revision 2",
    );
    for (const file of paths) expect((await stat(file)).mtimeMs).toBe(oldTime.getTime());

    const installations = () =>
      launches.filter((args) => args[0] === "fixture" && args.includes("install")).length;
    expect(installations()).toBe(1);
    await mkdir(path.join(currentWorkspace, "node_modules"));
    await writeFile(path.join(currentWorkspace, "node_modules/installed"), "dependencies");
    const advance = async () => {
      await git("git", ["-C", currentWorkspace, "add", "base.txt", ".pushdocs/config.json"]);
      await git("git", [
        "-C",
        currentWorkspace,
        "-c",
        "user.name=Test",
        "-c",
        "user.email=test@example.test",
        "commit",
        "--quiet",
        "-m",
        "next",
      ]);
      await git("git", [
        "-C",
        currentWorkspace,
        "push",
        "--quiet",
        remote,
        "HEAD:refs/heads/fixture",
      ]);
      head = (await git("git", ["-C", currentWorkspace, "rev-parse", "HEAD"])).stdout.trim();
      await preview?.tick();
      expect(session.status).toBe("queued");
      await preview?.tick();
      await vi.waitFor(() => expect(session.status).toBe("ready"));
    };
    await writeFile(path.join(currentWorkspace, "base.txt"), "new base");
    await advance();
    expect(installations()).toBe(1);
    expect(await readFile(path.join(currentWorkspace, "node_modules/installed"), "utf8")).toBe(
      "dependencies",
    );

    await writeFile(
      path.join(currentWorkspace, "package.json"),
      JSON.stringify({ name: "fixture", dependencies: { changed: "1.0.0" } }),
    );
    await git("git", ["-C", currentWorkspace, "add", "package.json"]);
    await advance();
    expect(installations()).toBe(2);

    // An explicit stop and restart must keep dependencies without reinstalling.
    session.desired_state = "stopped";
    await preview.tick();
    session.desired_state = "running";
    session.status = "queued";
    await preview.tick();
    await vi.waitFor(() => expect(session.status).toBe("ready"));
    expect(installations()).toBe(2);

    const queued = {
      ...session,
      id: "00000000-0000-4000-8000-000000000003",
      branch: "docs/other",
      port: 43001,
      status: "queued",
      log: "",
    };
    sessions.push(queued);
    const starts = () =>
      launches.filter((args) => args[0] === "fixture" && args.includes("start")).length;
    const beforeQueue = starts();
    await preview.tick();
    expect(queued.status).toBe("queued");
    expect(queued.log).toContain("Ожидаем свободное место");
    expect(starts()).toBe(beforeQueue);
    session.desired_state = "stopped";
    await preview.tick();
    await vi.waitFor(() => expect(queued.status).toBe("ready"));

    queued.desired_state = "stopped";
    backgroundBranches.push({
      project_id: session.project_id,
      full_ref: "docs/prepared",
      default_branch: "docs/prepared",
      head_commit_sha: head,
    });
    const beforePreparation = starts();
    await preview.tick();
    const preparedWorkspace = path.join(
      root,
      "worktrees",
      workspaceKey({ projectId: session.project_id, branch: "docs/prepared" }),
    );
    await vi.waitFor(async () =>
      expect(await readFile(path.join(preparedWorkspace, "docs/edited.md"), "utf8")).toBe(
        "revision 2",
      ),
    );
    expect(starts()).toBe(beforePreparation);
    const preparedSession = {
      ...session,
      id: "00000000-0000-4000-8000-000000000004",
      branch: "docs/prepared",
      status: "queued",
      desired_state: "running",
    };
    sessions.push(preparedSession);
    const beforeFetch = launches.filter((args) => args.includes("fetch")).length;
    await preview.tick();
    await vi.waitFor(() => expect(preparedSession.status).toBe("ready"));
    expect(launches.filter((args) => args.includes("fetch")).length).toBe(beforeFetch);
    preparedSession.desired_state = "stopped";
    await preview.tick();
    const beforeReopen = installations();
    sessions.splice(sessions.indexOf(preparedSession), 1, {
      ...preparedSession,
      id: "00000000-0000-4000-8000-000000000005",
      desired_state: "running",
      status: "queued",
    });
    await preview.tick();
    await vi.waitFor(() => expect(sessions.at(-1)?.status).toBe("ready"));
    expect(installations()).toBe(beforeReopen);
  } finally {
    await preview?.stopAll();
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
