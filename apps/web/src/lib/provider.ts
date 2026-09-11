import "server-only";
import { decryptSecret } from "@pushdocs/db";
import { createProvider, type GitProvider } from "@pushdocs/providers";
import { prepareVpnAccess } from "@pushdocs/vpn";

export interface ProviderConnectionTarget {
  base_url: string;
  connection_id: string;
  kind: "github" | "gitlab";
  secret_encrypted: string;
  vpn_profile_encrypted: string | null;
  vpn_slot: number | null;
}

export async function providerForConnection(
  target: ProviderConnectionTarget,
): Promise<GitProvider> {
  const access = await prepareVpnAccess({
    allowedOrigin: target.base_url,
    connectionId: target.connection_id,
    profile: target.vpn_profile_encrypted ? decryptSecret(target.vpn_profile_encrypted) : undefined,
    slot: target.vpn_slot,
  });
  return createProvider({
    baseUrl: target.base_url,
    kind: target.kind,
    request: access.fetch,
    token: decryptSecret(target.secret_encrypted),
  });
}
