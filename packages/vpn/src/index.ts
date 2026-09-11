import { createHash } from "node:crypto";

export const vpnSlotCount = 4;
export const vpnProfileLimit = 128 * 1024;

const allowedDirectives = new Set([
  "auth",
  "client",
  "dev",
  "nobind",
  "persist-key",
  "persist-tun",
  "port",
  "proto",
  "pull",
  "remote",
  "remote-cert-tls",
  "remote-random",
  "resolv-retry",
  "tls-client",
  "tls-version-min",
  "verify-x509-name",
]);
const inlineNames = new Set(["ca", "cert", "key", "tls-auth", "tls-crypt"]);

function directiveParts(line: string): string[] {
  return line.trim().split(/\s+/);
}

export function validateVpnProfile(value: string): string {
  if (!value || Buffer.byteLength(value) > vpnProfileLimit || value.includes("\0"))
    throw new Error("VPN_PROFILE_INVALID_SIZE");
  const normalized = `${value.replace(/\r\n?/g, "\n").trim()}\n`;
  const inline = new Map<string, string[]>();
  let activeInline: string | undefined;
  const directives = new Map<string, string[][]>();

  for (const sourceLine of normalized.split("\n")) {
    const line = sourceLine.trim();
    if (activeInline) {
      if (line.toLowerCase() === `</${activeInline}>`) activeInline = undefined;
      else inline.get(activeInline)?.push(sourceLine);
      continue;
    }
    const opening = line.match(/^<([a-z0-9-]+)>$/i);
    if (opening) {
      const name = opening[1]?.toLowerCase();
      if (!name || !inlineNames.has(name) || inline.has(name))
        throw new Error("VPN_PROFILE_UNSAFE_DIRECTIVE");
      activeInline = name;
      inline.set(name, []);
      continue;
    }
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    if (/^<\//.test(line)) throw new Error("VPN_PROFILE_INVALID_INLINE_BLOCK");
    const parts = directiveParts(line);
    const name = parts[0]?.toLowerCase();
    if (!name || !allowedDirectives.has(name)) throw new Error("VPN_PROFILE_UNSAFE_DIRECTIVE");
    const rows = directives.get(name) ?? [];
    rows.push(parts.slice(1));
    directives.set(name, rows);
  }
  if (activeInline) throw new Error("VPN_PROFILE_INVALID_INLINE_BLOCK");
  for (const name of ["ca", "cert", "key"])
    if (!inline.has(name)) throw new Error("VPN_PROFILE_MISSING_INLINE_CREDENTIALS");
  const ca = inline.get("ca")?.join("\n") ?? "";
  const cert = inline.get("cert")?.join("\n") ?? "";
  const key = inline.get("key")?.join("\n") ?? "";
  if (!ca.includes("BEGIN CERTIFICATE") || !cert.includes("BEGIN CERTIFICATE"))
    throw new Error("VPN_PROFILE_INVALID_CERTIFICATE");
  if (!key.includes("BEGIN ") || !key.includes("PRIVATE KEY") || key.includes("ENCRYPTED PRIVATE"))
    throw new Error("VPN_PROFILE_INVALID_PRIVATE_KEY");
  if (!directives.has("client") || !directives.has("tls-client"))
    throw new Error("VPN_PROFILE_CLIENT_MODE_REQUIRED");
  if (directives.get("dev")?.length !== 1 || directives.get("dev")?.[0]?.[0] !== "tun")
    throw new Error("VPN_PROFILE_TUN_REQUIRED");
  if (directives.get("remote-cert-tls")?.[0]?.[0] !== "server")
    throw new Error("VPN_PROFILE_SERVER_VERIFICATION_REQUIRED");
  const remotes = directives.get("remote") ?? [];
  if (remotes.length !== 1) throw new Error("VPN_PROFILE_SINGLE_REMOTE_REQUIRED");
  const [host, remotePort] = remotes[0] ?? [];
  if (!host || !/^[a-z0-9.-]+$/i.test(host) || host.startsWith("-") || host.endsWith("."))
    throw new Error("VPN_PROFILE_INVALID_REMOTE");
  const port = remotePort ?? directives.get("port")?.[0]?.[0] ?? "1194";
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65_535)
    throw new Error("VPN_PROFILE_INVALID_PORT");
  const protocol = directives.get("proto")?.[0]?.[0] ?? "udp";
  if (!new Set(["tcp", "tcp-client", "tcp4", "tcp4-client", "udp", "udp4"]).has(protocol))
    throw new Error("VPN_PROFILE_INVALID_PROTOCOL");
  return normalized;
}

export function vpnProfileFingerprint(profile: string): string {
  return createHash("sha256").update(validateVpnProfile(profile)).digest("hex");
}

export interface VpnAccess {
  fetch: (input: string | URL, init?: RequestInit) => Promise<Response>;
  gitProxyUrl?: string;
}

export interface VpnConnection {
  allowedOrigin: string;
  connectionId: string;
  profile?: string | null;
  slot?: number | null;
}

function gatewayToken(): string {
  const token = process.env.PUSHDOCS_VPN_GATEWAY_TOKEN;
  if (!token) throw new Error("PUSHDOCS_VPN_GATEWAY_TOKEN is required for VPN connections");
  return token;
}

function gatewayOrigin(slot: number): string {
  if (!Number.isInteger(slot) || slot < 1 || slot > vpnSlotCount)
    throw new Error("VPN_SLOT_INVALID");
  const template = process.env.PUSHDOCS_VPN_GATEWAY_ORIGIN ?? "http://vpn-gateway-{slot}:8080";
  return template.replace("{slot}", String(slot));
}

function encodedRequest(input: string | URL, init?: RequestInit): string {
  const metadata = {
    headers: [...new Headers(init?.headers).entries()],
    method: init?.method ?? "GET",
    url: String(input),
  };
  return Buffer.from(JSON.stringify(metadata)).toString("base64url");
}

export async function prepareVpnAccess(connection: VpnConnection): Promise<VpnAccess> {
  if (!connection.profile) return { fetch: (input, init) => fetch(input, init) };
  if (!connection.slot) throw new Error("VPN_SLOT_MISSING");
  if (new URL(connection.allowedOrigin).protocol !== "https:")
    throw new Error("VPN_REQUIRES_HTTPS_PROVIDER");
  const profile = validateVpnProfile(connection.profile);
  const token = gatewayToken();
  const origin = gatewayOrigin(connection.slot);
  const configured = await fetch(`${origin}/configure`, {
    body: profile,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/x-openvpn-profile",
      "x-pushdocs-allowed-origin": new URL(connection.allowedOrigin).origin,
      "x-pushdocs-connection-id": connection.connectionId,
      "x-pushdocs-profile-sha": vpnProfileFingerprint(profile),
    },
    method: "POST",
    signal: AbortSignal.timeout(45_000),
  });
  if (!configured.ok)
    throw new Error(`VPN_UNAVAILABLE: ${(await configured.text()).slice(0, 500)}`);
  return {
    fetch: (input, init) =>
      fetch(`${origin}/fetch`, {
        body: init?.body,
        headers: {
          authorization: `Bearer ${token}`,
          "x-pushdocs-request": encodedRequest(input, init),
        },
        method: "POST",
        signal: init?.signal,
      }),
    gitProxyUrl: `http://pushdocs:${encodeURIComponent(token)}@${new URL(origin).host}`,
  };
}

export async function clearVpnAccess(slot: number | null | undefined): Promise<void> {
  if (!slot) return;
  const response = await fetch(`${gatewayOrigin(slot)}/clear`, {
    headers: { authorization: `Bearer ${gatewayToken()}` },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("VPN_GATEWAY_CLEAR_FAILED");
}
