import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { runtimeMemoryMb } from "../../apps/preview/src/resources";
import { run } from "../../apps/preview/src/service";
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
