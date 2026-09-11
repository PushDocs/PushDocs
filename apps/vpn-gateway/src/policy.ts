export function remoteFromProfile(profile: string): {
  host: string;
  port: number;
  protocol: "tcp" | "udp";
} {
  let host = "";
  let remotePort: number | undefined;
  let defaultPort = 1194;
  let protocol: "tcp" | "udp" = "udp";
  let inline = false;
  for (const sourceLine of profile.split("\n")) {
    const line = sourceLine.trim();
    if (/^<[a-z0-9-]+>$/i.test(line)) {
      inline = true;
      continue;
    }
    if (inline) {
      if (/^<\/[a-z0-9-]+>$/i.test(line)) inline = false;
      continue;
    }
    const [name, first, second] = line.split(/\s+/);
    if (name === "remote") {
      host = first ?? "";
      remotePort = second ? Number(second) : undefined;
    } else if (name === "port" && first) defaultPort = Number(first);
    else if (name === "proto" && first) protocol = first.startsWith("tcp") ? "tcp" : "udp";
  }
  return { host, port: remotePort ?? defaultPort, protocol };
}

export function providerTargetAllowed(origin: string, target: URL): boolean {
  return target.origin === origin && !target.username && !target.password;
}

export function connectTargetAllowed(origin: string, hostname: string, port: number): boolean {
  const permitted = new URL(origin);
  const permittedPort = Number(permitted.port || 443);
  return hostname === permitted.hostname && port === permittedPort;
}
