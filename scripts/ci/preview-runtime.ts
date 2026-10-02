import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeMemoryMb } from "../../apps/preview/src/resources";
import { createPreviewService, run } from "../../apps/preview/src/service";
import { createWorkspaceManager } from "../../apps/preview/src/workspaces";

const root = await mkdtemp("/data/previews/ci-runtime-");
const uid = 11000;
try {
  await chmod(root, 0o711);
  const source = path.join(root, "source");
  await mkdir(source);
  const git = (args: string[]) =>
    run(["git", "-c", "user.name=CI", "-c", "user.email=ci@example.test", ...args], {
      cwd: source,
      timeoutMs: 10_000,
    });
  await git(["init", "--quiet"]);
  await writeFile(path.join(source, "page.md"), "page");
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", "fixture"]);
  const headSha = (await git(["rev-parse", "HEAD"])).trim();
  const manager = createWorkspaceManager({
    root,
    run,
    access: async () => ({ remote: source, env: process.env }),
    fetch: (operation) => operation(),
  });
  const branch = { projectId: "ci-one", branch: "main", headSha };
  const one = await manager.ensure(branch, new AbortController().signal);
  await manager.grantReadAccess(branch, uid);
  await run(["chown", "-R", `${uid}:${uid}`, one.workspace], { cwd: root, timeoutMs: 10_000 });
  await run(
    [
      process.execPath,
      "-e",
      "const fs=require('node:fs');for(const directory of process.argv.slice(1)) fs.readdirSync(directory)",
      root,
      path.dirname(one.workspace),
    ],
    {
      cwd: root,
      uid,
      gid: uid,
      timeoutMs: 10_000,
    },
  );
  const env = {
    PATH: process.env.PATH,
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "safe.directory",
    GIT_CONFIG_VALUE_0: one.workspace,
  };
  assert.equal(
    (
      await run(["git", "rev-parse", "HEAD"], {
        cwd: one.workspace,
        env,
        uid,
        gid: uid,
        timeoutMs: 10_000,
      })
    ).trim(),
    headSha,
  );
  await assert.rejects(
    run(["git", "config", "--local", "ci.write", "forbidden"], {
      cwd: one.workspace,
      env,
      uid,
      gid: uid,
      timeoutMs: 10_000,
    }),
  );
  const shared = (
    await run(["git", "rev-parse", "--git-common-dir"], { cwd: one.workspace, timeoutMs: 10_000 })
  ).trim();

  const twoBranch = { ...branch, projectId: "ci-two" };
  await manager.ensure(twoBranch, new AbortController().signal);
  await manager.grantReadAccess(twoBranch, uid);
  await assert.rejects(
    run(
      [
        process.execPath,
        "-e",
        "require('node:fs').readFileSync(process.argv[1])",
        path.join(one.workspace, "page.md"),
      ],
      { cwd: root, uid, gid: uid, timeoutMs: 10_000 },
    ),
  );
  await assert.rejects(
    run(
      [
        process.execPath,
        "-e",
        "require('node:fs').readFileSync(process.argv[1])",
        path.join(shared, "config"),
      ],
      { cwd: root, uid, gid: uid, timeoutMs: 10_000 },
    ),
  );

  // Production upgrades copy repositories previously owned by the runtime UID.
  const legacyId = "00000000-0000-4000-8000-000000000001";
  const legacy = path.join(root, legacyId);
  await run(["git", "clone", "--quiet", source, legacy], { cwd: root, timeoutMs: 10_000 });
  await mkdir(path.join(legacy, "node_modules"));
  await writeFile(path.join(legacy, "node_modules/installed"), "preserved");
  await run(["chown", "-R", `${uid}:${uid}`, legacy], { cwd: root, timeoutMs: 10_000 });
  await run(["chown", "0:0", legacy], { cwd: root, timeoutMs: 10_000 });
  await chmod(legacy, 0o700);
  const migrated = await manager.ensure(
    { ...branch, projectId: "ci-legacy" },
    new AbortController().signal,
    legacyId,
  );
  assert.equal(
    await readFile(path.join(migrated.workspace, "node_modules/installed"), "utf8"),
    "preserved",
  );

  await assert.rejects(
    run(
      [
        process.execPath,
        "-e",
        "globalThis.data=Buffer.alloc(32*1024*1024,1);setInterval(()=>{},1000)",
      ],
      {
        cwd: root,
        uid,
        gid: uid,
        timeoutMs: 5000,
        memoryLimitMb: 16,
      },
    ),
    /превышен лимит памяти 16 МБ/,
  );
  assert.equal(await runtimeMemoryMb(uid), 0);
  // A package manager may spawn a site into a different process group.
  await mkdir(path.join(source, ".pushdocs"));
  await writeFile(
    path.join(source, ".pushdocs/config.json"),
    JSON.stringify({
      version: 1,
      preview: {
        install: [process.execPath, "-e", ""],
        start: [process.execPath, "runner.cjs", "{port}"],
        output: "build",
      },
    }),
  );
  await writeFile(
    path.join(source, "runner.cjs"),
    `const {spawn}=require('node:child_process');
const child=spawn(process.execPath,['-e',"require('node:http').createServer((q,r)=>{r.statusCode=Number(process.argv[2]);r.end('ready')}).listen(Number(process.argv[1]),'0.0.0.0')",process.argv[2],process.argv[3]==='fail'?'503':'200'],{detached:true,stdio:'ignore'});
if(process.argv[3]==='fail')setTimeout(()=>{console.error('[ERROR] fixture startup failed');process.exit(0)},250);
setInterval(()=>{},1000);`,
  );
  await git(["add", "."]);
  await git(["commit", "--quiet", "-m", "detached site fixture"]);
  let lifecycleHead = (await git(["rev-parse", "HEAD"])).trim();
  let failureWrites = 0;
  const session = {
    id: "00000000-0000-4000-8000-000000000018",
    project_id: "ci-lifecycle",
    branch: "main",
    port: 43018,
    status: "queued",
    desired_state: "running",
    log: "",
    updated_at: new Date(),
  };
  const lifecycleOptions = {
    workspaceRoot: path.join(root, "lifecycle"),
    memoryLimitMb: 256,
    gitAccess: async () => ({ remote: source, env: process.env }),
    repository: {
      reconcilePreviewLeases: async () => {},
      listPreviewSessions: async () => [session],
      listPreviewWorkspaces: async () => [],
      getProjectSyncTarget: async () => ({ root_path: "." }),
      listChangedWorkingFiles: async () => ({
        branch: { head_commit_sha: lifecycleHead },
        files: [],
      }),
      listPreviewAttachments: async () => [],
      updatePreviewSession: async (_id: string, values: { status?: string }) => {
        if (values.status === "failed") failureWrites++;
        return Object.assign(session, values);
      },
    } as never,
  };
  let service = createPreviewService(lifecycleOptions);
  try {
    await service.tick();
    for (let i = 0; i < 150 && session.status !== "ready" && session.status !== "failed"; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(session.status, "ready", session.log);
    await Promise.all([service.stopAll(), service.stopAll()]);
    assert.equal(
      await runtimeMemoryMb(11018),
      0,
      "Detached site survived stopAll and can keep the preview port occupied",
    );
    const config = JSON.parse(await readFile(path.join(source, ".pushdocs/config.json"), "utf8"));
    config.preview.start.push("fail");
    await writeFile(path.join(source, ".pushdocs/config.json"), JSON.stringify(config));
    await git(["commit", "--quiet", "-am", "startup failure fixture"]);
    lifecycleHead = (await git(["rev-parse", "HEAD"])).trim();
    session.status = "queued";
    session.log = "";
    service = createPreviewService(lifecycleOptions);
    await service.tick();
    for (let i = 0; i < 150 && session.status !== "failed"; i++)
      await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(session.status, "failed", session.log);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    assert.equal(failureWrites, 1, "Concurrent exit and startup handlers overwrote failure twice");
    assert.equal(
      await runtimeMemoryMb(11018),
      0,
      "Failed startup left a detached server on the port",
    );
  } finally {
    await service.stopAll();
    for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
      try {
        if (/^Uid:\s+11018\s/m.test(await readFile(`/proc/${pid}/status`, "utf8")))
          process.kill(Number(pid), "SIGKILL");
      } catch {}
    }
  }
  const cgroup = await readFile("/sys/fs/cgroup/memory.max", "utf8");
  assert.notEqual(cgroup.trim(), "max");
  assert.equal(Number(cgroup), 5 * 1024 ** 3);
  assert.notEqual((await readFile("/sys/fs/cgroup/cpu.max", "utf8")).split(" ")[0], "max");
  console.log(
    "PASS: isolated worktrees, read-only project Git access, process memory guard and container resource limits",
  );
} finally {
  await rm(root, { recursive: true, force: true });
}
