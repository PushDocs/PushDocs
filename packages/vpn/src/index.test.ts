import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVpnAccess, validateVpnProfile, vpnProfileFingerprint } from "./index";

const profile = `
client
tls-client
dev tun
proto tcp
remote vpn.example.test 1194
pull
remote-cert-tls server
auth SHA256
<ca>
-----BEGIN CERTIFICATE-----
ca
-----END CERTIFICATE-----
</ca>
<cert>
-----BEGIN CERTIFICATE-----
cert
-----END CERTIFICATE-----
</cert>
<key>
-----BEGIN PRIVATE KEY-----
key
-----END PRIVATE KEY-----
</key>
`;

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.PUSHDOCS_VPN_GATEWAY_TOKEN;
});

describe("VPN profiles", () => {
  it("accepts a self-contained client profile", () => {
    expect(validateVpnProfile(profile)).toContain("remote vpn.example.test 1194");
    expect(vpnProfileFingerprint(profile)).toHaveLength(64);
  });

  it.each(["up /tmp/script", "plugin malicious.so", "auth-user-pass /tmp/password"])(
    "rejects unsafe directive %s",
    (directive) => {
      expect(() => validateVpnProfile(`${profile}\n${directive}\n`)).toThrow(
        "VPN_PROFILE_UNSAFE_DIRECTIVE",
      );
    },
  );

  it("requires server certificate verification", () => {
    expect(() => validateVpnProfile(profile.replace("remote-cert-tls server", ""))).toThrow(
      "VPN_PROFILE_SERVER_VERIFICATION_REQUIRED",
    );
  });

  it("does not contact a gateway for direct connections", async () => {
    const request = vi.fn(async () => new Response());
    vi.stubGlobal("fetch", request);
    const access = await prepareVpnAccess({
      allowedOrigin: "https://gitlab.test",
      connectionId: "connection",
    });
    await access.fetch("https://gitlab.test/api/v4/projects");
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("configures a slot and relays provider requests", async () => {
    process.env.PUSHDOCS_VPN_GATEWAY_TOKEN = "gateway-secret";
    const request = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response("[]", { status: 200 }));
    vi.stubGlobal("fetch", request);
    const access = await prepareVpnAccess({
      allowedOrigin: "https://gitlab.test/path",
      connectionId: "connection",
      profile,
      slot: 2,
    });
    await access.fetch("https://gitlab.test/api/v4/projects", {
      headers: { "PRIVATE-TOKEN": "provider-secret" },
    });
    expect(request.mock.calls[0]?.[0]).toBe("http://vpn-gateway-2:8080/configure");
    expect(request.mock.calls[1]?.[0]).toBe("http://vpn-gateway-2:8080/fetch");
    expect(access.gitProxyUrl).toBe("http://pushdocs:gateway-secret@vpn-gateway-2:8080");
  });
});
