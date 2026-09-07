import { afterEach, describe, expect, it } from "vitest";
import { createOpaqueToken, hashInvitationToken, hashOpaqueToken } from "./repository";

const previousPepper = process.env.PUSHDOCS_SESSION_PEPPER;

afterEach(() => {
  if (previousPepper === undefined) delete process.env.PUSHDOCS_SESSION_PEPPER;
  else process.env.PUSHDOCS_SESSION_PEPPER = previousPepper;
});

describe("opaque tokens", () => {
  it("creates a random token with its SHA-256 hash", () => {
    const first = createOpaqueToken();
    const second = createOpaqueToken();
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.hash).toBe(hashInvitationToken(first.token));
    expect(second.token).not.toBe(first.token);
  });

  it("hashes sessions with the installation pepper", () => {
    process.env.PUSHDOCS_SESSION_PEPPER = "p".repeat(32);
    expect(hashOpaqueToken("token")).toBe(
      "4d459e16598108b3261ef147f582b1e953bf55b6c6b9220ca98a38f7c875341b",
    );
    process.env.PUSHDOCS_SESSION_PEPPER = "q".repeat(32);
    expect(hashOpaqueToken("token")).not.toBe(
      "4d459e16598108b3261ef147f582b1e953bf55b6c6b9220ca98a38f7c875341b",
    );
  });

  it.each([undefined, "too-short"])("rejects the session pepper %s", (pepper) => {
    if (pepper === undefined) delete process.env.PUSHDOCS_SESSION_PEPPER;
    else process.env.PUSHDOCS_SESSION_PEPPER = pepper;
    expect(() => hashOpaqueToken("token")).toThrow("PUSHDOCS_SESSION_PEPPER is required");
  });

  it("hashes invitation tokens without installation state", () => {
    expect(hashInvitationToken("invitation")).toBe(
      "a3013c082c75edc913598c3baac1afa18f7633fe8f014896ab2f1a72ff83d8ba",
    );
  });
});
