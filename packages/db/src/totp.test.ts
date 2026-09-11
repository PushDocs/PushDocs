import { describe, expect, it } from "vitest";
import { createTotpUri, generateTotpSecret, totpCode, verifyTotp } from "./totp";

describe("TOTP interoperability", () => {
  // RFC 6238 SHA-1 vectors, reduced to the six digits used by Google Authenticator.
  const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
  it.each([
    [59, "287082"],
    [1111111109, "081804"],
    [1111111111, "050471"],
    [1234567890, "005924"],
    [2000000000, "279037"],
    [20000000000, "353130"],
  ])("matches RFC time %s", (seconds, code) => {
    expect(totpCode(secret, Number(seconds) * 1000)).toBe(code);
  });
  it("accepts only six digits within one adjacent interval", () => {
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1);
    expect(verifyTotp(secret, "287082", 60_000)).toBe(1);
    expect(verifyTotp(secret, "287082", 90_000)).toBeNull();
    expect(verifyTotp(secret, "2870820", 59_000)).toBeNull();
    expect(verifyTotp(secret, "abcdef", 59_000)).toBeNull();
  });
  it("creates independent 160-bit keys and an interoperable URI", () => {
    const key = generateTotpSecret();
    expect(key).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(key);
    const uri = new URL(createTotpUri("a+b@example.test", key));
    expect(uri.searchParams.get("issuer")).toBe("PushDocs");
    expect(uri.searchParams.get("secret")).toBe(key);
    expect(uri.searchParams.get("period")).toBe("30");
  });
});
