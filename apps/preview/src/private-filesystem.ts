import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execute = promisify(execFile);
const helper = fileURLToPath(new URL("../src/private_tree.py", import.meta.url));
export const privateTreeCleanupIdentity = { uid: 65534, gid: 65534 } as const;
export const defaultPreviewCacheMaxMb = 8192;
export const privateTreeCopyBudget = defaultPreviewCacheMaxMb * 1024 * 1024;

export async function privateTreeOperation(
  operation:
    | "copy-caches"
    | "preserve-times"
    | "remove"
    | "clear-package-cache"
    | "clear-webpack-cache"
    | "remove-file"
    | "prepare-cleanup"
    | "clear",
  source: string,
  destination?: string,
  identity?: { uid: number; gid: number },
  copyBudgetBytes = privateTreeCopyBudget,
): Promise<{ complete: boolean; bytes: number }> {
  const { stdout } = await execute(
    "python3",
    [
      helper,
      operation,
      source,
      ...(operation === "prepare-cleanup"
        ? [String(privateTreeCleanupIdentity.uid), String(privateTreeCleanupIdentity.gid)]
        : destination
          ? [destination, String(copyBudgetBytes)]
          : []),
    ],
    {
      env: { PATH: process.env.PATH, LANG: "C.UTF-8" },
      timeout: 10 * 60_000,
      maxBuffer: 1024 * 1024,
      ...(process.platform === "linux" && process.getuid?.() === 0 && identity ? identity : {}),
    },
  );
  return JSON.parse(stdout);
}
