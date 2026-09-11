import { type ChildProcess, spawn } from "node:child_process";
import { lookup } from "node:dns/promises";
import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { connect } from "node:net";
import path from "node:path";
import type { Duplex } from "node:stream";
import { validateVpnProfile, vpnProfileFingerprint, vpnProfileLimit } from "@pushdocs/vpn";
import { connectTargetAllowed, providerTargetAllowed, remoteFromProfile } from "./policy";

const port = 8080;
const runtimeDirectory = "/run/pushdocs-vpn";
const profilePath = path.join(runtimeDirectory, "client.ovpn");
const statePath = path.join(runtimeDirectory, "state");
const dnsPath = path.join(runtimeDirectory, "dns");
const resolvBackupPath = path.join(runtimeDirectory, "resolv.conf.original");
const upScript = "/app/apps/vpn-gateway/scripts/up.sh";
const downScript = "/app/apps/vpn-gateway/scripts/down.sh";
const gatewayToken = process.env.PUSHDOCS_VPN_GATEWAY_TOKEN;
if (!gatewayToken) throw new Error("PUSHDOCS_VPN_GATEWAY_TOKEN is required");

let allowedOrigin: string | undefined;
let configuredConnection: string | undefined;
let configuredFingerprint: string | undefined;
let connected = false;
let openvpn: ChildProcess | undefined;
let configuration: Promise<void> = Promise.resolve();
const relayedSockets = new Set<Duplex>();

function authorized(request: IncomingMessage): boolean {
  return request.headers.authorization === `Bearer ${gatewayToken}`;
}

function proxyAuthorized(request: IncomingMessage): boolean {
  const expected = Buffer.from(`pushdocs:${gatewayToken}`).toString("base64");
  return request.headers["proxy-authorization"] === `Basic ${expected}`;
}

function closeRelays(): void {
  connected = false;
  for (const socket of relayedSockets) socket.destroy();
  relayedSockets.clear();
}

async function run(command: string, args: string[]): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let detail = "";
    let output = "";
    child.stdout.on("data", (chunk: Buffer) => {
      output = (output + chunk.toString()).slice(-4000);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      detail = (detail + chunk.toString()).slice(-1000);
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`${command} failed (${code}): ${detail}`));
    });
  });
}

async function installKillSwitch(profile: string): Promise<void> {
  const remote = remoteFromProfile(profile);
  const addresses = await lookup(remote.host, { all: true, family: 4 });
  if (addresses.length === 0) throw new Error("VPN_REMOTE_DNS_FAILED");
  const defaultRoute = await run("ip", ["route", "show", "default"]);
  const egressInterface = defaultRoute.match(/\bdev\s+(\S+)/)?.[1];
  if (!egressInterface) throw new Error("VPN_EGRESS_INTERFACE_NOT_FOUND");
  await run("iptables", ["-F", "OUTPUT"]);
  await run("iptables", ["-P", "OUTPUT", "DROP"]);
  await run("iptables", ["-A", "OUTPUT", "-o", "lo", "-j", "ACCEPT"]);
  await run("iptables", [
    "-A",
    "OUTPUT",
    "-m",
    "conntrack",
    "--ctstate",
    "ESTABLISHED,RELATED",
    "-j",
    "ACCEPT",
  ]);
  await run("iptables", ["-A", "OUTPUT", "-o", "tun+", "-j", "ACCEPT"]);
  for (const address of addresses)
    await run("iptables", [
      "-A",
      "OUTPUT",
      "-o",
      egressInterface,
      "-p",
      remote.protocol,
      "-d",
      address.address,
      "--dport",
      String(remote.port),
      "-j",
      "ACCEPT",
    ]);
}

async function readBody(request: IncomingMessage, limit = vpnProfileLimit): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.byteLength;
    if (size > limit) throw new Error("REQUEST_TOO_LARGE");
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, size);
}

async function stopVpn(): Promise<void> {
  closeRelays();
  if (openvpn) {
    const child = openvpn;
    openvpn = undefined;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        child.kill("SIGKILL");
        resolve();
      }, 5000);
      child.once("close", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  await rm(statePath, { force: true });
  await copyFile(resolvBackupPath, "/etc/resolv.conf");
  await run("iptables", ["-P", "OUTPUT", "ACCEPT"]);
  await run("iptables", ["-F", "OUTPUT"]);
}

async function waitUntilConnected(child: ChildProcess): Promise<void> {
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("OPENVPN_EXITED_BEFORE_CONNECTING");
    const state = await readFile(statePath, "utf8").catch(() => "");
    if (state.trim() === "up") {
      connected = true;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("OPENVPN_CONNECT_TIMEOUT");
}

async function configure(
  profile: string,
  fingerprint: string,
  connectionId: string,
  origin: string,
) {
  const normalized = validateVpnProfile(profile);
  if (vpnProfileFingerprint(normalized) !== fingerprint)
    throw new Error("VPN_PROFILE_SHA_MISMATCH");
  const parsedOrigin = new URL(origin);
  if (parsedOrigin.protocol !== "https:" || parsedOrigin.username || parsedOrigin.password)
    throw new Error("VPN_ALLOWED_ORIGIN_INVALID");
  if (
    connected &&
    configuredFingerprint === fingerprint &&
    configuredConnection === connectionId &&
    allowedOrigin === parsedOrigin.origin
  )
    return;
  await stopVpn();
  await writeFile(profilePath, normalized, { mode: 0o600 });
  await installKillSwitch(normalized);
  await rm(statePath, { force: true });
  const child = spawn(
    "openvpn",
    [
      "--config",
      profilePath,
      "--auth-nocache",
      "--script-security",
      "2",
      "--up",
      upScript,
      "--down",
      downScript,
      "--down-pre",
      "--setenv",
      "PUSHDOCS_DNS_FILE",
      dnsPath,
      "--setenv",
      "PUSHDOCS_RESOLV_BACKUP",
      resolvBackupPath,
      "--setenv",
      "PUSHDOCS_STATE_FILE",
      statePath,
      "--verb",
      "3",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  openvpn = child;
  let lastError = "";
  child.stderr?.on("data", (chunk: Buffer) => {
    lastError = (lastError + chunk.toString()).slice(-2000);
  });
  child.once("close", () => {
    if (openvpn === child) openvpn = undefined;
    closeRelays();
    if (lastError) console.error(JSON.stringify({ event: "openvpn.exit", detail: lastError }));
  });
  try {
    await waitUntilConnected(child);
  } catch (error) {
    await stopVpn();
    throw error;
  }
  configuredConnection = connectionId;
  configuredFingerprint = fingerprint;
  allowedOrigin = parsedOrigin.origin;
}

function send(response: ServerResponse, status: number, message = ""): void {
  response.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  response.end(message);
}

function safeResponseHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};
  const excluded = new Set([
    "connection",
    "content-encoding",
    "content-length",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
  ]);
  for (const [name, value] of headers) if (!excluded.has(name.toLowerCase())) result[name] = value;
  return result;
}

async function relayFetch(request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!connected || !allowedOrigin) return send(response, 503, "VPN_UNAVAILABLE");
  const encoded = request.headers["x-pushdocs-request"];
  if (typeof encoded !== "string" || encoded.length > 16_384)
    return send(response, 400, "VPN_REQUEST_INVALID");
  const metadata = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as {
    headers?: Array<[string, string]>;
    method?: string;
    url?: string;
  };
  const target = new URL(metadata.url ?? "");
  if (!providerTargetAllowed(allowedOrigin, target))
    return send(response, 403, "VPN_TARGET_REJECTED");
  const method = metadata.method?.toUpperCase() ?? "GET";
  const body = ["GET", "HEAD"].includes(method) ? undefined : request;
  const upstream = await fetch(target, {
    body: body as BodyInit | undefined,
    duplex: body ? "half" : undefined,
    headers: new Headers(metadata.headers),
    method,
    redirect: "manual",
    signal: AbortSignal.timeout(120_000),
  } as RequestInit & { duplex?: "half" });
  response.writeHead(upstream.status, safeResponseHeaders(upstream.headers));
  if (!upstream.body) {
    response.end();
    return;
  }
  const reader = upstream.body.getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      if (!response.write(value)) await new Promise((resolve) => response.once("drain", resolve));
    }
  } finally {
    await reader.cancel();
  }
  response.end();
}

await mkdir(runtimeDirectory, { recursive: true, mode: 0o700 });
await copyFile("/etc/resolv.conf", resolvBackupPath);

setInterval(() => {
  void readFile(statePath, "utf8")
    .then((state) => {
      if (state.trim() === "down") closeRelays();
      else if (state.trim() === "up" && openvpn) connected = true;
    })
    .catch(() => closeRelays());
}, 500).unref();

const server = createServer((request, response) => {
  void (async () => {
    if (!authorized(request)) return send(response, 401, "UNAUTHORIZED");
    if (request.method === "POST" && request.url === "/configure") {
      const fingerprint = request.headers["x-pushdocs-profile-sha"];
      const connectionId = request.headers["x-pushdocs-connection-id"];
      const origin = request.headers["x-pushdocs-allowed-origin"];
      if (
        typeof fingerprint !== "string" ||
        typeof connectionId !== "string" ||
        typeof origin !== "string"
      )
        return send(response, 400, "VPN_CONFIGURATION_INVALID");
      const profile = (await readBody(request)).toString("utf8");
      configuration = configuration
        .catch(() => undefined)
        .then(() => configure(profile, fingerprint, connectionId, origin));
      await configuration;
      return send(response, 204);
    }
    if (request.method === "POST" && request.url === "/clear") {
      configuration = configuration
        .catch(() => undefined)
        .then(async () => {
          await stopVpn();
          allowedOrigin = undefined;
          configuredConnection = undefined;
          configuredFingerprint = undefined;
        });
      await configuration;
      return send(response, 204);
    }
    if (request.method === "POST" && request.url === "/fetch") return relayFetch(request, response);
    if (request.method === "GET" && request.url === "/health/ready")
      return send(response, 200, "ready");
    return send(response, 404, "NOT_FOUND");
  })().catch((error: unknown) => {
    console.error(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }),
    );
    if (!response.headersSent) send(response, 502, "VPN_GATEWAY_ERROR");
    else response.destroy();
  });
});

server.on("connect", (request, client, head) => {
  if (!proxyAuthorized(request) || !connected || !allowedOrigin) return client.destroy();
  const target = new URL(`https://${request.url ?? ""}`);
  const targetPort = Number(target.port || 443);
  if (!connectTargetAllowed(allowedOrigin, target.hostname, targetPort)) return client.destroy();
  const upstream = connect({ host: target.hostname, port: targetPort });
  relayedSockets.add(client);
  relayedSockets.add(upstream);
  const cleanup = () => {
    relayedSockets.delete(client);
    relayedSockets.delete(upstream);
  };
  client.once("close", cleanup);
  upstream.once("close", cleanup);
  upstream.once("connect", () => {
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (head.length) upstream.write(head);
    upstream.pipe(client);
    client.pipe(upstream);
  });
  upstream.once("error", () => client.destroy());
});

server.listen(port, "0.0.0.0", () => {
  console.log(
    JSON.stringify({ event: "vpn-gateway.ready", port, slot: process.env.PUSHDOCS_VPN_SLOT }),
  );
});

for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close();
    void stopVpn().finally(() => process.exit(0));
  });
