import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const previousKey = process.env.PUSHDOCS_ENCRYPTION_KEY;

afterEach(() => {
  if (previousKey === undefined) delete process.env.PUSHDOCS_ENCRYPTION_KEY;
  else process.env.PUSHDOCS_ENCRYPTION_KEY = previousKey;
});

function useRandomKey(): void {
  process.env.PUSHDOCS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
}

describe("connection secret encryption", () => {
  it("round trips without storing plaintext", () => {
    useRandomKey();
    const encrypted = encryptSecret("gitlab-token");
    expect(encrypted).not.toContain("gitlab-token");
    expect(decryptSecret(encrypted)).toBe("gitlab-token");
  });

  it("uses a fresh initialization vector for each encryption", () => {
    useRandomKey();
    expect(encryptSecret("same secret")).not.toBe(encryptSecret("same secret"));
  });

  it("requires an encryption key", () => {
    delete process.env.PUSHDOCS_ENCRYPTION_KEY;
    expect(() => encryptSecret("secret")).toThrow("PUSHDOCS_ENCRYPTION_KEY is required");
  });

  it.each(["short", randomBytes(31).toString("base64")])(
    "rejects the invalid encryption key %s",
    (key) => {
      process.env.PUSHDOCS_ENCRYPTION_KEY = key;
      expect(() => encryptSecret("secret")).toThrow("must be a base64 encoded 32-byte key");
    },
  );

  it("rejects ciphertext changed after encryption", () => {
    useRandomKey();
    const encrypted = encryptSecret("secret");
    const changed = `${encrypted.slice(0, -2)}AA`;
    expect(() => decryptSecret(changed)).toThrow();
  });

  it("rejects malformed ciphertext", () => {
    useRandomKey();
    expect(() => decryptSecret("not-encrypted")).toThrow("Invalid encrypted secret");
  });

  it("rejects ciphertext encrypted with another key", () => {
    useRandomKey();
    const encrypted = encryptSecret("secret");
    useRandomKey();
    expect(() => decryptSecret(encrypted)).toThrow();
  });

  it("binds TOTP ciphertext to its user and setup stage", () => {
    useRandomKey();
    const encrypted = encryptSecret("secret", "user-a:totp:pending");
    expect(decryptSecret(encrypted, "user-a:totp:pending")).toBe("secret");
    expect(() => decryptSecret(encrypted, "user-b:totp:pending")).toThrow();
    expect(() => decryptSecret(encrypted, "user-a:totp:active")).toThrow();
    expect(() => decryptSecret(encrypted)).toThrow();
  });
});
