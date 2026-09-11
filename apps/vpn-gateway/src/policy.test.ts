import { expect, it } from "vitest";
import { connectTargetAllowed, providerTargetAllowed, remoteFromProfile } from "./policy";

it("reads the one permitted VPN endpoint without inspecting inline credentials", () => {
  expect(
    remoteFromProfile(`proto tcp\nport 1194\nremote vpn.example.test\n<key>\nsecret\n</key>`),
  ).toEqual({ host: "vpn.example.test", port: 1194, protocol: "tcp" });
});

it("relays requests only to the configured provider origin", () => {
  const origin = "https://gitlab.internal.test";
  expect(providerTargetAllowed(origin, new URL(`${origin}/api/v4/projects`))).toBe(true);
  expect(providerTargetAllowed(origin, new URL("https://metadata.internal/"))).toBe(false);
  expect(providerTargetAllowed(origin, new URL("https://gitlab.internal.test.evil.test/"))).toBe(
    false,
  );
});

it("permits Git CONNECT only to the configured host and port", () => {
  const origin = "https://gitlab.internal.test";
  expect(connectTargetAllowed(origin, "gitlab.internal.test", 443)).toBe(true);
  expect(connectTargetAllowed(origin, "gitlab.internal.test", 8443)).toBe(false);
  expect(connectTargetAllowed(origin, "other.internal.test", 443)).toBe(false);
});
