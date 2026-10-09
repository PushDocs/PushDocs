import { mcpScopes } from "@pushdocs/db";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { authorizeGet, authorizePost } from "./oauth";

const { store, user, projects } = vi.hoisted(() => ({
  store: {
    client: vi.fn(),
    rateLimit: vi.fn(),
    consent: vi.fn(),
    consentRequest: vi.fn(),
    authorize: vi.fn(),
  },
  user: { id: "user", displayName: "Alex" },
  projects: [{ id: "project", name: "Docs", role: "admin" }],
}));
vi.mock("@pushdocs/db", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@pushdocs/db")>()),
  getDatabase: vi.fn(),
  // biome-ignore lint/complexity/useArrowFunction: This mock must be constructible.
  McpRepository: vi.fn(function () {
    return store;
  }),
}));
vi.mock("@/lib/server", () => ({
  optionalUser: async () => user,
  repository: () => ({ listProjects: async () => projects }),
}));

const origin = "https://pushdocs.test";
const pending = {
  clientId: "client",
  redirectUri: "https://client.test/callback",
  resource: `${origin}/mcp`,
  challenge: "a".repeat(43),
  scopes: [...mcpScopes],
};
const post = (scopes: string[], decision = "allow") => {
  const body = new URLSearchParams({ nonce: "nonce", decision, projects: "project" });
  for (const scope of scopes) body.append("scopes", scope);
  return new Request(`${origin}/oauth/authorize`, {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
};
beforeEach(() => {
  vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", origin);
  store.client.mockResolvedValue({ name: "ChatGPT", redirect_uris: [pending.redirectUri] });
  store.consent.mockResolvedValue("nonce");
  store.consentRequest.mockResolvedValue(pending);
  store.authorize.mockResolvedValue({ code: "code", request: pending });
});

describe("OAuth permission selection", () => {
  it("offers every permission while defaulting to read only", async () => {
    const query = new URLSearchParams({
      client_id: pending.clientId,
      redirect_uri: pending.redirectUri,
      resource: pending.resource,
      response_type: "code",
      code_challenge: pending.challenge,
      code_challenge_method: "S256",
    });
    const response = await authorizeGet(new Request(`${origin}/oauth/authorize?${query}`));
    expect(response.status).toBe(200);
    const html = await response.text();
    for (const scope of mcpScopes) {
      expect(html).toContain(
        `name="scopes" value="${scope}"${scope === "pushdocs:read" ? " checked" : ""}>`,
      );
    }
    query.set("scope", "pushdocs:write pushdocs:preview");
    const explicit = await (
      await authorizeGet(new Request(`${origin}/oauth/authorize?${query}`))
    ).text();
    expect(explicit).toContain('value="pushdocs:read">');
    expect(explicit).toContain('value="pushdocs:write" checked');
    expect(explicit).toContain('value="pushdocs:preview" checked');
  });
  it("passes only the user's chosen permissions to grant creation", async () => {
    const response = await authorizePost(post(["pushdocs:write", "pushdocs:submit"]));
    expect(response.status).toBe(303);
    expect(store.authorize).toHaveBeenCalledWith("user", "nonce", ["project"], true, [
      "pushdocs:write",
      "pushdocs:submit",
    ]);
  });
  it.each([{ scopes: [] }, { scopes: ["unknown:scope"] }])(
    "rejects invalid selections $scopes and preserves project selection",
    async ({ scopes }) => {
      const response = await authorizePost(post(scopes));
      expect(response.status).toBe(400);
      const html = await response.text();
      expect(html).toContain('role="alert"');
      expect(html).toContain('name="projects" value="project" checked');
      expect(html).not.toContain('value="pushdocs:read" checked');
      expect(store.authorize).not.toHaveBeenCalled();
    },
  );
  it("allows denial with no permissions selected", async () => {
    store.authorize.mockResolvedValueOnce({ code: null, request: pending });
    const response = await authorizePost(post([], "deny"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=access_denied");
  });
});
