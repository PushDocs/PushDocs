import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export function positiveInteger(
  value: string | number | undefined,
  fallback: number,
  name: string,
) {
  const parsed = Number(value ?? fallback);
  if (!Number.isSafeInteger(parsed) || parsed < 1)
    throw new Error(`${name}: требуется положительное целое число`);
  return parsed;
}

export function runtimeMemoryError(limitMb: number) {
  return `Предпросмотр остановлен: превышен лимит памяти ${limitMb} МБ. Уменьшите нагрузку сайта или увеличьте лимит предпросмотра в настройках сервера.`;
}

export function nodeHeapLimitMb(memoryLimitMb: number, requested?: string | number) {
  return Math.min(
    positiveInteger(requested, 1536, "Лимит heap Node предпросмотра"),
    Math.max(128, memoryLimitMb - 1024),
  );
}

export async function runtimeMemoryMb(uid: number, procRoot = "/proc") {
  if (process.platform !== "linux" && procRoot === "/proc") return 0;
  let rssKb = 0;
  for (const filename of await readdir(procRoot)) {
    if (!/^\d+$/.test(filename)) continue;
    try {
      const status = await readFile(path.join(procRoot, filename, "status"), "utf8");
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === uid)
        rssKb += Number(/^VmRSS:\s+(\d+)/m.exec(status)?.[1] ?? 0);
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return rssKb / 1024;
}

export async function runtimeProcessIds(uid: number, procRoot = "/proc") {
  const pids: number[] = [];
  for (const filename of await readdir(procRoot)) {
    if (!/^\d+$/.test(filename)) continue;
    try {
      const status = await readFile(path.join(procRoot, filename, "status"), "utf8");
      if (Number(/^Uid:\s+(\d+)/m.exec(status)?.[1]) === uid && !/^State:\s+Z/m.test(status))
        pids.push(Number(filename));
    } catch (error) {
      if (!["ENOENT", "ESRCH"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
    }
  }
  return pids;
}

export async function stopRuntimeProcesses(uid: number | undefined) {
  // Never enumerate/kill the developer's user or the controller. Production runtime UIDs
  // are dedicated to one preview port and execute only inside the preview container.
  if (process.platform !== "linux" || process.getuid?.() !== 0 || uid === undefined) return;
  if (!Number.isSafeInteger(uid) || uid <= 0) throw new Error("Недопустимый UID предпросмотра");
  const signal = async (name: NodeJS.Signals) => {
    for (const pid of await runtimeProcessIds(uid)) {
      try {
        process.kill(pid, name);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  };
  await signal("SIGTERM");
  const deadline = Date.now() + 2500;
  while ((await runtimeProcessIds(uid)).length > 0) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    await signal("SIGKILL");
    if (Date.now() > deadline && (await runtimeProcessIds(uid)).length > 0)
      throw new Error("Не удалось завершить все процессы предпросмотра и освободить порт");
  }
}

export function watchRuntimeMemory(
  uid: number | undefined,
  limitMb: number | undefined,
  onLimit: (message: string) => void,
  onSample?: (memoryMb: number) => void,
) {
  if (uid === undefined || limitMb === undefined || process.platform !== "linux") return () => {};
  let busy = false;
  let stopped = false;
  const timer = setInterval(() => {
    if (busy || stopped) return;
    busy = true;
    void runtimeMemoryMb(uid)
      .then((memory) => {
        if (!stopped) onSample?.(memory);
        if (!stopped && memory > limitMb) {
          stop();
          onLimit(runtimeMemoryError(limitMb));
        }
      })
      .catch((error) => {
        if (!stopped) {
          stop();
          onLimit(`Не удалось проверить память предпросмотра: ${String(error)}`);
        }
      })
      .finally(() => {
        busy = false;
      });
  }, 1000);
  timer.unref();
  const stop = () => {
    stopped = true;
    clearInterval(timer);
  };
  return stop;
}
