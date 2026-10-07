import { describe, expect, it } from "vitest";
import { consentFailure, consentPage } from "./consent-page";

const input = {
  clientName: "ChatGPT",
  userName: "Александр",
  nonce: "fixture-nonce",
  scopes: ["pushdocs:read"],
  redirectUri: "https://chatgpt.com/oauth/callback?client=fixture",
  projects: [{ id: "project", name: "Sendsay docs", role: "admin" }],
};
describe("OAuth consent presentation and browser policy", () => {
  it("allows the registered callback origin and only nonce-authorized styles", async () => {
    const response = consentPage(input);
    const policy = response.headers.get("content-security-policy");
    const html = await response.text();
    const nonce = /<style nonce="([^"]+)"/.exec(html)?.[1];
    expect(policy).toContain("form-action 'self' https://chatgpt.com;");
    expect(policy).toContain(`style-src 'nonce-${nonce}'`);
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).not.toContain("unsafe-inline");
    expect(response.headers.get("referrer-policy")).toBe("same-origin");
    expect(html).toContain("Читать документацию");
    expect(html).not.toContain("Редактировать документы");
  });
  it("escapes client and project names without changing form decisions", async () => {
    const html = await consentPage({
      ...input,
      clientName: "<script>alert(1)</script>",
      projects: [{ id: "project", role: "admin", name: '<img src=x onerror="alert(1)">' }],
    }).text();
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain('name="decision" value="allow"');
    expect(html).toContain('name="decision" value="deny"');
  });
  it("provides an empty state and readable recovery instead of raw JSON", async () => {
    const empty = await consentPage({ ...input, projects: [] }).text();
    expect(empty).toContain('value="allow" disabled');
    expect(empty).toContain("У вас пока нет доступных проектов");
    const expired = consentFailure("Форма уже использована. Начните подключение заново.");
    expect(expired.status).toBe(400);
    expect(expired.headers.get("content-type")).toContain("text/html");
    expect(await expired.text()).toContain('role="alert"');
  });
});
