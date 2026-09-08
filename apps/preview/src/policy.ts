import { createHmac, timingSafeEqual } from "node:crypto";
import { safePath } from "@pushdocs/content";

export interface PreviewRuntime {
  image: string;
  memoryMiB: number;
  cpus: number;
  timeoutSeconds: number;
}

export function expiredPreviewIds(
  rows: Array<{ id: string; projectId: string; branch: string; status: string; createdAt: Date }>,
  now: Date,
): string[] {
  const counts = new Map<string, number>();
  return [...rows]
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .filter((row) => {
      if (!["ready", "failed"].includes(row.status)) return false;
      const key = JSON.stringify([row.projectId, row.branch, row.status]);
      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);
      return (
        now.getTime() - row.createdAt.getTime() >= 7 * 24 * 60 * 60 * 1000 ||
        count > (row.status === "ready" ? 3 : 10)
      );
    })
    .map((row) => row.id);
}

export function resolveRuntime(
  projectId: string,
  name: string,
  source?: string,
  fallbackImage?: string,
): PreviewRuntime {
  const profiles = JSON.parse(source || "{}");
  const selected = Object.hasOwn(profiles, name) ? profiles[name] : undefined;
  if (!selected && name === "default" && fallbackImage)
    return { image: fallbackImage, memoryMiB: 4096, cpus: 2, timeoutSeconds: 900 };
  if (
    !selected ||
    !Array.isArray(selected.projects) ||
    !selected.projects.some((project: unknown) => project === "*" || project === projectId)
  )
    throw new Error("Preview runtime is not available for this project");
  const runtime = {
    image: selected.image,
    memoryMiB: selected.memoryMiB ?? 4096,
    cpus: selected.cpus ?? 2,
    timeoutSeconds: selected.timeoutSeconds ?? 900,
  };
  if (
    typeof runtime.image !== "string" ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]*$/.test(runtime.image) ||
    !Number.isInteger(runtime.memoryMiB) ||
    runtime.memoryMiB < 512 ||
    runtime.memoryMiB > 16384 ||
    !Number.isFinite(runtime.cpus) ||
    runtime.cpus < 0.5 ||
    runtime.cpus > 8 ||
    !Number.isInteger(runtime.timeoutSeconds) ||
    runtime.timeoutSeconds < 30 ||
    runtime.timeoutSeconds > 1800
  )
    throw new Error("Invalid preview runtime limits");
  return runtime;
}
export function containerArguments(
  id: string,
  image: string,
  volume: string,
  hostRoot?: string,
  runtime?: PreviewRuntime,
): string[] {
  if (
    !/^[a-f0-9-]{36}$/.test(id) ||
    !/^[a-zA-Z0-9_-]+$/.test(volume) ||
    !/^[a-zA-Z0-9][a-zA-Z0-9/_.:@-]*$/.test(image)
  )
    throw new Error("Invalid runner configuration");
  if (
    hostRoot &&
    (!hostRoot.startsWith("/") ||
      hostRoot.includes(",") ||
      hostRoot.includes("\n") ||
      hostRoot.split("/").includes(".."))
  )
    throw new Error("Invalid preview host directory");
  return [
    "run",
    "--rm",
    "--name",
    `pushdocs-preview-${id}`,
    "--network=none",
    "--read-only",
    "--cap-drop=ALL",
    "--security-opt=no-new-privileges:true",
    "--user=1000:1000",
    `--memory=${runtime?.memoryMiB ?? 4096}m`,
    `--cpus=${runtime?.cpus ?? 2}`,
    "--pids-limit=256",
    "--tmpfs=/tmp:rw,exec,size=2g,mode=1777",
    ...["input", "control", "output"].flatMap((dir) => [
      "--mount",
      `${hostRoot ? `type=bind,src=${hostRoot}/${id}/${dir},dst=/${dir}` : `type=volume,src=${volume},dst=/${dir},volume-subpath=${id}/${dir}`}${dir === "output" ? "" : ",readonly"}`,
    ]),
    "--env=HOME=/tmp",
    "--env=YARN_CACHE_FOLDER=/opt/yarn-cache",
    "--env=COREPACK_ENABLE_NETWORK=0",
    "--workdir=/tmp",
    image,
    "node",
    "/control/run.mjs",
  ];
}
export function previewToken(key: string, id: string, expires: number): string {
  return createHmac("sha256", key).update(`${id}:${expires}`).digest("hex");
}
export function verifyPreviewToken(
  key: string,
  id: string,
  expires: string,
  token: string,
  now = Math.floor(Date.now() / 1000),
): boolean {
  if (!/^\d+$/.test(expires) || Number(expires) < now || !/^[a-f0-9]{64}$/.test(token))
    return false;
  return timingSafeEqual(
    Buffer.from(token, "hex"),
    Buffer.from(previewToken(key, id, Number(expires)), "hex"),
  );
}
export function snapshotFiles(
  base: Map<string, Uint8Array>,
  drafts: Array<{ path: string; content: string | null }>,
): Map<string, Uint8Array> {
  const files = new Map(base);
  for (const draft of drafts) {
    safePath(draft.path);
    if (draft.content === null) files.delete(draft.path);
    else files.set(draft.path, Buffer.from(draft.content));
  }
  for (const filePath of files.keys()) safePath(filePath);
  if ([...files.values()].reduce((total, bytes) => total + bytes.byteLength, 0) > 256 * 1024 * 1024)
    throw new Error("Snapshot exceeds 256 MiB");
  return files;
}
