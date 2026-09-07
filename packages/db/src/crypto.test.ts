import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

const previousKey = process.env.PUSHDOCS_ENCRYPTION_KEY;

afterEach(() => {
  process.env.PUSHDOCS_ENCRYPTION_KEY = previousKey;
});

describe("connection secret encryption", () => {
  it("round trips without storing plaintext", () => {
    process.env.PUSHDOCS_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const encrypted = encryptSecret("gitlab-token");
    expect(encrypted).not.toContain("gitlab-token");
    expect(decryptSecret(encrypted)).toBe("gitlab-token");
  });
});
