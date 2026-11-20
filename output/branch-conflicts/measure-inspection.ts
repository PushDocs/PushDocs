import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { decryptSecret, getDatabase, closeDatabase, PushDocsRepository } from "@pushdocs/db";
import { prepareVpnAccess } from "@pushdocs/vpn";
import { GitTransport } from "../../apps/worker/src/git-transport";

const run = promisify(execFile);
const store = new PushDocsRepository(getDatabase());
try {
  const job = await getDatabase().selectFrom("jobs").select("payload").where("kind", "=", "branch.conflicts").orderBy("created_at", "desc").limit(1).executeTakeFirstOrThrow();
  const payload = job.payload as { projectId: string; branch: string; sourceBranch: string };
  const target = await store.getProjectSyncTarget(payload.projectId);
  if (!target) throw new Error("Project connection unavailable");
  const access = await prepareVpnAccess({ connectionId: target.connection_id, allowedOrigin: target.base_url, profile: target.vpn_profile_encrypted ? decryptSecret(target.vpn_profile_encrypted) : undefined, slot: target.vpn_slot });
  const remote = new URL(target.clone_url);
  const origin = new URL(target.base_url);
  if (remote.protocol === "http:" && origin.protocol === "https:" && remote.hostname === origin.hostname && !remote.port && !origin.port) remote.protocol = "https:";
  const directory = path.resolve("../../data/git", `inspection-measure-${randomUUID()}`);
  const transport = new GitTransport({ directory, remote: remote.href, proxyUrl: access.gitProxyUrl, authorization: `Authorization: Basic ${Buffer.from(`${target.kind === "gitlab" ? "oauth2" : "x-access-token"}:${decryptSecret(target.secret_encrypted)}`).toString("base64")}` });
  const started = performance.now();
  const snapshot = await transport.inspectConflicts({ branch: payload.branch, sourceBranch: payload.sourceBranch });
  const durationMs = Math.round(performance.now() - started);
  const size = (await run("du", ["-sk", directory])).stdout.split(/\s+/)[0];
  console.log(JSON.stringify({ durationMs, conflicts: snapshot.files.length, binaryConflicts: snapshot.files.filter((file) => file.kind === "binary").length, mediaContentsSkipped: snapshot.mediaContentsSkipped, cacheKiB: Number(size), unsupported: Boolean(snapshot.unsupportedReason) }));
} finally {
  await closeDatabase();
}
