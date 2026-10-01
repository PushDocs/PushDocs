import { spawn, spawnSync } from "node:child_process";

const uid = 11000;
const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
  detached: true,
  gid: uid,
  stdio: "ignore",
  uid,
});

await new Promise((resolve, reject) => {
  child.once("spawn", resolve);
  child.once("error", reject);
});

try {
  process.kill(-child.pid, "SIGTERM");
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Preview child did not stop")), 2000);
    child.once("exit", (_code, signal) => {
      clearTimeout(timeout);
      if (signal === "SIGTERM") resolve();
      else reject(new Error(`Preview child exited with ${signal ?? "no signal"}`));
    });
  });
} finally {
  if (child.exitCode === null && child.signalCode === null)
    spawnSync(
      process.execPath,
      ["-e", 'process.kill(-Number(process.argv[1]), "SIGKILL")', String(child.pid)],
      { gid: uid, timeout: 2000, uid },
    );
}
