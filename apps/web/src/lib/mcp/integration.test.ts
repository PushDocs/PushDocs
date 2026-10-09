import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { createServer as httpServer } from "node:http";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { chromium } from "@playwright/test";
import {
  appendEvent,
  closeDatabase,
  createDatabase,
  getDatabase,
  McpRepository,
  migrateToLatest,
  opaque,
  PushDocsRepository,
  pkceChallenge,
  tokenDigest,
} from "@pushdocs/db";
import { sql } from "kysely";
import sharp from "sharp";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as Y from "yjs";
import { POST } from "@/app/mcp/route";
import { providerForConnection } from "@/lib/provider";
import { optionalUser } from "@/lib/server";
import { authorizeGet, authorizePost, register, token } from "./oauth";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/server", () => ({
  optionalUser: vi.fn(),
  repository: () => new PushDocsRepository(getDatabase()),
}));
vi.mock("@/lib/provider", () => ({ providerForConnection: vi.fn() }));
const address = process.env.PUSHDOCS_TEST_DATABASE_URL;
const suite = address ? describe : describe.skip;
suite("MCP with real PostgreSQL and HTTP SDK client", () => {
  const name = `pushdocs_mcp_${randomBytes(8).toString("hex")}`,
    origin = "https://pushdocs.test",
    resource = `${origin}/mcp`;
  let admin: ReturnType<typeof createDatabase>,
    repo: PushDocsRepository,
    auth: McpRepository,
    userId: string,
    projectId: string,
    clientId: string,
    fixtureDatabaseUrl: string;
  const request = (route: string, form: Record<string, string>) =>
    new Request(`${origin}${route}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Origin: origin },
      body: new URLSearchParams(form),
    });
  async function grant(
    scopes = ["pushdocs:read", "pushdocs:write", "pushdocs:preview", "pushdocs:submit"],
  ) {
    const verifier = opaque() + opaque();
    const nonce = await auth.consent(userId, {
      clientId,
      redirectUri: "http://localhost:45678/callback",
      resource,
      challenge: pkceChallenge(verifier),
      scopes,
    });
    const approval = await auth.authorize(userId, nonce, [projectId]);
    const tokens = await auth.exchange({
      code: approval.code ?? "",
      clientId,
      redirectUri: "http://localhost:45678/callback",
      verifier,
      resource,
    });
    return { ...tokens, principal: await auth.authenticate(tokens.access_token) };
  }
  async function client(access: string) {
    const transport = new StreamableHTTPClientTransport(new URL(resource), {
      requestInit: { headers: { Authorization: `Bearer ${access}` } },
      fetch: async (input, init) => {
        const req = new Request(input, init);
        return req.method === "POST" ? POST(req) : new Response(null, { status: 405 });
      },
    });
    const c = new Client({ name: "PushDocs integration", version: "1.0" });
    await c.connect(transport);
    return c;
  }
  beforeAll(async () => {
    const url = new URL(address ?? "");
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname))
      throw new Error("Only disposable local PostgreSQL is accepted");
    admin = createDatabase(url.toString());
    await sql.raw(`create database ${name}`).execute(admin);
    url.pathname = `/${name}`;
    fixtureDatabaseUrl = url.toString();
    vi.stubEnv("DATABASE_URL", fixtureDatabaseUrl);
    vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", origin);
    vi.stubEnv("PUSHDOCS_ENCRYPTION_KEY", randomBytes(32).toString("base64"));
    await migrateToLatest(getDatabase());
    repo = new PushDocsRepository(getDatabase());
    auth = new McpRepository(getDatabase());
    const user = await repo.createOperator({
      email: "mcp@example.test",
      displayName: "MCP",
      passwordHash: "hash",
    });
    userId = user.id;
    vi.mocked(optionalUser).mockResolvedValue({
      id: userId,
      displayName: "MCP",
      email: "mcp@example.test",
      isInstanceOperator: true,
    });
    const connection = await repo.createConnection({
      baseUrl: "https://provider.invalid",
      kind: "gitlab",
      name: "MCP test",
      secretEncrypted: "never-return-this",
    });
    const project = await repo.createProject({
      connectionId: connection.id,
      defaultBranch: "main",
      name: "MCP test",
      operatorUserId: userId,
      repositoryFullName: "test/docs",
      repositoryProviderId: "42",
      repositoryUrl: "https://provider.invalid/test/docs.git",
      rootPath: ".",
      slug: "mcp",
    });
    projectId = project.id;
    await repo.replaceImportedDocuments(projectId, "main", "head-1", [
      {
        path: "docs/intro.md",
        title: "Intro",
        content: "# Hello\n\nA simple document.\n\n[Other](./other.md)",
        contentHash: "one",
        locale: "default",
        version: "current",
      },
      {
        path: "docs/other.md",
        title: "Other",
        content: "# Other\n\nHello world.",
        contentHash: "two",
        locale: "default",
        version: "current",
      },
      {
        path: "docs/legacy.mdx",
        title: "Legacy integration",
        content: "# Legacy integration\n\n<!-- prettier-ignore -->\n\nConnect amoCRM.",
        contentHash: "legacy",
        locale: "default",
        version: "current",
      },
      {
        path: "sidebars.js",
        title: "Sidebar",
        content: 'module.exports = {docs: ["intro"]};',
        contentHash: "three",
        locale: "default",
        version: "current",
      },
    ]);
    clientId = await auth.registerClient("Claude Code / Codex test", [
      "http://localhost:45678/callback",
    ]);
  }, 30_000);
  beforeEach(() => {
    vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", origin);
  });
  afterAll(async () => {
    await closeDatabase();
    if (admin) {
      // Pool shutdown can resolve before PostgreSQL observes the closing sockets.
      // Wait for our connections instead of killing them during their shutdown.
      let remaining = 0;
      for (let attempt = 0; attempt < 100; attempt++) {
        const result = await sql<{
          count: string;
        }>`select count(*) from pg_stat_activity where datname=${name}`.execute(admin);
        remaining = Number(result.rows[0]?.count ?? 0);
        if (remaining === 0) break;
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(remaining, "Fixture connections remained after pool shutdown").toBe(0);
      await sql.raw(`drop database if exists ${name}`).execute(admin);
      await admin.destroy();
    }
  });
  it.skipIf(process.env.PUSHDOCS_MCP_NETWORK_SMOKE !== "1")(
    "serves the built standalone app over TCP",
    async () => {
      const listener = createServer();
      await new Promise<void>((resolve) => listener.listen(0, "127.0.0.1", resolve));
      const bound = listener.address();
      if (!bound || typeof bound === "string") throw new Error("No test port");
      const port = bound.port;
      await new Promise<void>((resolve, reject) =>
        listener.close((error) => (error ? reject(error) : resolve())),
      );
      const server = spawn(process.execPath, ["apps/web/.next/standalone/apps/web/server.js"], {
        cwd: process.cwd(),
        env: {
          ...process.env,
          DATABASE_URL: fixtureDatabaseUrl,
          PUSHDOCS_PUBLIC_ORIGIN: origin,
          PUSHDOCS_ENCRYPTION_KEY: randomBytes(32).toString("base64"),
          PUSHDOCS_SESSION_PEPPER: "synthetic-mcp-smoke-session-pepper",
          PORT: String(port),
          HOSTNAME: "127.0.0.1",
        },
        stdio: ["ignore", "pipe", "pipe"],
      });
      let output = "";
      server.stdout.on("data", (chunk) => {
        output += chunk.toString();
      });
      server.stderr.on("data", (chunk) => {
        output += chunk.toString();
      });
      const base = `http://127.0.0.1:${port}`;
      const remoteFetch: typeof fetch = (input, init) => {
        const request = new Request(input, init);
        return fetch(new Request(`${base}${new URL(request.url).pathname}`, request));
      };
      const c = new Client({ name: "Standalone smoke", version: "1.0" });
      try {
        let ready = false;
        for (let attempt = 0; attempt < 100; attempt++) {
          if (server.exitCode !== null) throw new Error(`Standalone exited: ${output}`);
          try {
            ready = (await fetch(`${base}/.well-known/oauth-protected-resource`)).ok;
          } catch {}
          if (ready) break;
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(ready, output).toBe(true);
        const metadata = await (
          await fetch(`${base}/.well-known/oauth-authorization-server`)
        ).json();
        expect(metadata.registration_endpoint).toBe(`${origin}/oauth/register`);
        const access = await grant();
        await c.connect(
          new StreamableHTTPClientTransport(new URL(resource), {
            requestInit: { headers: { Authorization: `Bearer ${access.access_token}` } },
            fetch: remoteFetch,
          }),
        );
        expect((await c.listTools()).tools.length).toBeGreaterThan(25);
        expect(
          (
            await c.callTool({
              name: "get_document",
              arguments: { projectId, branch: "main", path: "docs/intro.md" },
            })
          ).isError,
        ).not.toBe(true);
        // Load external dictionaries in the packaged production runtime as well.
        expect(
          (
            await c.callTool({
              name: "check_spelling",
              arguments: { projectId, branch: "main", path: "docs/intro.md" },
            })
          ).isError,
        ).not.toBe(true);
      } finally {
        await c.close().catch(() => {});
        server.kill("SIGTERM");
        await new Promise<void>((resolve) => {
          if (server.exitCode !== null) resolve();
          else server.once("exit", () => resolve());
        });
      }
    },
    30_000,
  );
  it("pins operation results and CI preview to the submitted SHA", async () => {
    const changeSetId = randomUUID();
    await appendEvent(getDatabase(), {
      entityId: changeSetId,
      projectId,
      revision: 1,
      type: "change-set.submitted",
      payload: {
        commitSha: "submitted-sha",
        commitUrl: "https://provider.invalid/commit/submitted-sha",
      },
    });
    const job = await getDatabase()
      .insertInto("jobs")
      .values({
        kind: "change-set.submit",
        status: "done",
        payload: {
          projectId,
          branch: "main",
          changeSetId,
          targetBranch: "release",
          createReview: true,
        },
      })
      .returning("id")
      .executeTakeFirstOrThrow();
    const review = (sha: string) => ({
      externalId: "17",
      headSha: sha,
      sourceBranch: "main",
      targetBranch: "release",
      state: "open" as const,
      title: "Review",
      url: "https://provider.invalid/review/17",
      checks: [
        {
          id: "deploy",
          name: "preview:deploy",
          conclusion: "success" as const,
          durationMs: 10,
          required: false,
          url: null,
        },
      ],
    });
    await repo.replaceChangeRequests(projectId, [review("different-sha")]);
    vi.stubEnv("PUSHDOCS_PREVIEW_URL", "https://preview.example.test/{MR_NUMBER}");
    const access = await grant();
    await expect(
      auth.authenticate(access.access_token, "https://another.test/mcp"),
    ).rejects.toThrow();
    const c = await client(access.access_token);
    try {
      const read = async () =>
        (
          await c.callTool({
            name: "get_operation_status",
            arguments: { projectId, operationId: job.id },
          })
        ).structuredContent as {
          result: { commitSha: string; currentBranchSha: string; ciPreviewUrl: string | null };
        };
      const stale = await read();
      expect(stale.result.commitSha).toBe("submitted-sha");
      expect(stale.result.currentBranchSha).toBe("head-1");
      expect(stale.result.ciPreviewUrl).toBeNull();
      await repo.replaceChangeRequests(projectId, [review("submitted-sha")]);
      expect((await read()).result.ciPreviewUrl).toBe("https://preview.example.test/17");
    } finally {
      await c.close();
    }
  });
  it.skipIf(process.env.PUSHDOCS_MCP_BROWSER_SMOKE !== "1")(
    "redirects browser consent to a different callback origin",
    async () => {
      let posts = 0;
      let base = "";
      const server = httpServer(async (req, res) => {
        if (req.url?.startsWith("/callback")) {
          res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
          res.end("<h1>Подключение готово</h1>");
          return;
        }
        try {
          const chunks: Buffer[] = [];
          for await (const chunk of req) chunks.push(Buffer.from(chunk));
          const request = new Request(`${base}${req.url}`, {
            method: req.method,
            headers: req.headers as Record<string, string>,
            ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
          });
          if (req.method === "POST") posts++;
          const response =
            req.method === "POST" ? await authorizePost(request) : await authorizeGet(request);
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(Buffer.from(await response.arrayBuffer()));
        } catch {
          res.writeHead(500);
          res.end("Fixture failure");
        }
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const bound = server.address();
      if (!bound || typeof bound === "string") throw new Error("No test port");
      base = `http://127.0.0.1:${bound.port}`;
      // Different origin, same disposable fixture server. No user accounts or external callback.
      const callback = `http://localhost:${bound.port}/callback`;
      vi.stubEnv("PUSHDOCS_PUBLIC_ORIGIN", base);
      const id = await auth.registerClient("ChatGPT", [callback]);
      const query = new URLSearchParams({
        client_id: id,
        redirect_uri: callback,
        response_type: "code",
        resource: `${base}/mcp`,
        code_challenge: pkceChallenge(opaque() + opaque()),
        code_challenge_method: "S256",
        scope: "pushdocs:read",
        state: "fixture-state",
      });
      const browser = await chromium.launch();
      try {
        const page = await browser.newPage();
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(`${base}/oauth/authorize?${query}`);
        const nonce = await page.locator('input[name="nonce"]').inputValue();
        await mkdir("output/playwright/oauth", { recursive: true });
        await page.screenshot({
          path: "output/playwright/oauth/consent-desktop.png",
          fullPage: true,
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({
          path: "output/playwright/oauth/consent-mobile.png",
          fullPage: true,
        });
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
        ).toBe(true);
        await page.setViewportSize({ width: 1280, height: 900 });
        await page.getByRole("button", { name: "Разрешить", exact: true }).click();
        expect(await page.getByRole("alert").textContent()).toContain(
          "Выберите хотя бы один проект",
        );
        expect(await page.locator('input[name="nonce"]').inputValue()).toBe(nonce);
        await page.locator('input[name="projects"]').first().check();
        await page.getByRole("button", { name: "Разрешить", exact: true }).click();
        await page.waitForURL(
          (url) => url.hostname === "localhost" && url.pathname === "/callback",
          { timeout: 4000 },
        );
        expect(await page.getByRole("heading").textContent()).toBe("Подключение готово");
        expect(posts).toBe(2);
        const returned = new URL(page.url());
        expect(returned.searchParams.get("state")).toBe("fixture-state");
        expect(returned.searchParams.get("iss")).toBe(base);
        expect(returned.searchParams.has("code")).toBe(true);
        const replay = await authorizePost(
          new Request(`${base}/oauth/authorize`, {
            method: "POST",
            headers: { Origin: base, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
              nonce,
              decision: "allow",
              projects: projectId,
              scopes: "pushdocs:read",
            }),
          }),
        );
        expect(replay.status).toBe(400);
        expect(replay.headers.get("content-type")).toContain("text/html");
        expect(await replay.text()).toContain("Эта форма уже использована");
        await page.goto(`${base}/oauth/authorize?${query}`);
        await page.getByRole("button", { name: "Отказать", exact: true }).click();
        await page.waitForURL(
          (url) => url.hostname === "localhost" && url.pathname === "/callback",
          { timeout: 4000 },
        );
        expect(new URL(page.url()).searchParams.get("error")).toBe("access_denied");
        expect(
          (
            await sql<{
              count: string;
            }>`select count(*) from mcp_grants where client_id=${id}`.execute(getDatabase())
          ).rows[0]?.count,
        ).toBe("1");
      } finally {
        await browser.close();
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve())),
        );
      }
    },
    20_000,
  );
  it("returns OAuth discovery challenge and rejects bad Origin", async () => {
    const response = await POST(new Request(resource, { method: "POST" }));
    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("oauth-protected-resource");
    expect(
      (
        await POST(
          new Request(resource, { method: "POST", headers: { Origin: "https://evil.test" } }),
        )
      ).status,
    ).toBe(403);
  });
  it("runs public-client registration and consent with PKCE and issuer identification", async () => {
    const registered = await register(
      new Request(`${origin}/oauth/register`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_name: "Test public client",
          redirect_uris: ["http://localhost:45678/callback"],
        }),
      }),
    );
    expect(registered.status).toBe(201);
    const verifier = opaque() + opaque();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: "http://localhost:45678/callback",
      response_type: "code",
      resource,
      code_challenge: pkceChallenge(verifier),
      code_challenge_method: "S256",
      scope: "pushdocs:read",
      state: "state-value",
    });
    const consent = await authorizeGet(new Request(`${origin}/oauth/authorize?${params}`));
    expect(consent.status).toBe(200);
    const html = await consent.text();
    const nonce = /name="nonce" value="([^"]+)"/.exec(html)?.[1];
    expect(nonce).toBeTruthy();
    const approval = await authorizePost(
      request("/oauth/authorize", {
        nonce: nonce ?? "",
        decision: "allow",
        projects: projectId,
        scopes: "pushdocs:write",
      }),
    );
    expect(approval.status).toBe(303);
    const callback = new URL(approval.headers.get("location") ?? "");
    expect(callback.searchParams.get("iss")).toBe(origin);
    expect(callback.searchParams.get("state")).toBe("state-value");
    const bad = await token(
      request("/oauth/token", {
        grant_type: "authorization_code",
        resource,
        client_id: clientId,
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: "http://localhost:45678/callback",
        code_verifier: opaque() + opaque(),
      }),
    );
    expect(bad.status).toBe(400);
    const valid = await token(
      request("/oauth/token", {
        grant_type: "authorization_code",
        resource,
        client_id: clientId,
        code: callback.searchParams.get("code") ?? "",
        redirect_uri: "http://localhost:45678/callback",
        code_verifier: verifier,
      }),
    );
    expect(valid.status).toBe(200);
    const tokens = await valid.json();
    expect(tokens.scope).toBe("pushdocs:write");
    expect((await auth.authenticate(tokens.access_token)).scopes).toEqual(["pushdocs:write"]);
  });
  it("rejects empty or expanded permission selections without consuming consent", async () => {
    const nonce = await auth.consent(userId, {
      clientId,
      redirectUri: "http://localhost:45678/callback",
      resource,
      challenge: pkceChallenge(opaque() + opaque()),
      scopes: ["pushdocs:read"],
    });
    await expect(auth.authorize(userId, nonce, [projectId], true, [])).rejects.toMatchObject({
      code: "invalid_scope",
    });
    await expect(
      auth.authorize(userId, nonce, [projectId], true, ["pushdocs:submit"]),
    ).rejects.toMatchObject({ code: "invalid_scope" });
    expect(
      (await auth.authorize(userId, nonce, [projectId], true, ["pushdocs:read"])).code,
    ).toBeTruthy();
  });
  it("searches imported documents with unsupported MDX through MCP", async () => {
    const access = await grant(["pushdocs:read"]);
    const c = await client(access.access_token);
    try {
      for (const name of ["search_documents", "find_documents_by_topic"]) {
        const result = await c.callTool({
          name,
          arguments: { projectId, branch: "main", query: "amoCRM" },
        });
        expect(result.isError).not.toBe(true);
        expect(result.structuredContent).toMatchObject({
          total: 1,
          items: [{ path: "docs/legacy.mdx", snippet: expect.stringContaining("amoCRM") }],
        });
      }
    } finally {
      await c.close();
    }
  });
  it("initializes, lists annotations, stages and searches drafts, and rejects stale revisions", async () => {
    const access = await grant();
    const c = await client(access.access_token);
    try {
      const tools = await c.listTools();
      expect(tools.tools.find((t) => t.name === "get_document")?.annotations?.readOnlyHint).toBe(
        true,
      );
      expect(tools.tools.find((t) => t.name === "submit_changes")?.annotations?.readOnlyHint).toBe(
        false,
      );
      const projects = await c.callTool({ name: "list_projects", arguments: {} });
      expect(JSON.stringify(projects)).toContain(projectId);
      expect(JSON.stringify(projects)).not.toContain("never-return-this");
      const doc = await c.callTool({
        name: "get_document",
        arguments: { projectId, branch: "main", path: "docs/intro.md" },
      });
      const state = doc.structuredContent as { changeSetRevision: number; revisionToken: string };
      const args = {
        projectId,
        branch: "main",
        path: "docs/intro.md",
        content: "# Hello\n\nMCPword docs.",
        expectedRevision: state.changeSetRevision,
        revisionToken: state.revisionToken,
        idempotencyKey: "update-once",
      };
      const [edited, concurrentReplay] = await Promise.all([
        c.callTool({ name: "update_document", arguments: args }),
        c.callTool({ name: "update_document", arguments: args }),
      ]);
      expect(concurrentReplay).toEqual(edited);
      expect(edited.isError).not.toBe(true);
      expect(await c.callTool({ name: "update_document", arguments: args })).toEqual(edited);
      expect(
        (
          await c.callTool({
            name: "update_document",
            arguments: { ...args, idempotencyKey: "stale" },
          })
        ).isError,
      ).toBe(true);
      expect(
        JSON.stringify(
          await c.callTool({
            name: "search_documents",
            arguments: { projectId, branch: "main", query: "MCPword" },
          }),
        ),
      ).toContain("docs/intro.md");
      const current = await repo.getBranchState(projectId, "main");
      const created = await c.callTool({
        name: "create_document",
        arguments: {
          projectId,
          branch: "main",
          path: "docs/new.md",
          content: "# New\n\nHello world.",
          expectedRevision: current.changeSet?.revision ?? 0,
          idempotencyKey: "new-doc",
        },
      });
      expect(created.isError).not.toBe(true);
      const revision = (created.structuredContent as { revision: number }).revision;
      const navigation = await c.callTool({
        name: "add_document_to_navigation",
        arguments: {
          projectId,
          branch: "main",
          document: "docs/new.md",
          parent: "docs",
          expectedRevision: revision,
          idempotencyKey: "navigation",
        },
      });
      expect(navigation.isError).not.toBe(true);
      expect(
        JSON.stringify(
          await c.callTool({ name: "get_navigation", arguments: { projectId, branch: "main" } }),
        ),
      ).toContain("new");
      expect(
        (
          await c.callTool({
            name: "check_spelling",
            arguments: { projectId, branch: "main", path: "docs/new.md" },
          })
        ).isError,
      ).not.toBe(true);
      expect(
        (await c.callTool({ name: "get_change_set", arguments: { projectId, branch: "main" } }))
          .isError,
      ).not.toBe(true);
      expect(
        (
          await c.callTool({
            name: "get_document",
            arguments: {
              projectId: "00000000-0000-4000-8000-000000000000",
              branch: "main",
              path: "docs/new.md",
            },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await c.close();
    }
  }, 30_000);
  it("rotates refresh tokens, revokes a reused family and rejects expired access", async () => {
    const initial = await grant();
    const rotated = await auth.refresh(initial.refresh_token, clientId);
    expect(await auth.authenticate(rotated.access_token)).toBeTruthy();
    await expect(auth.refresh(initial.refresh_token, clientId)).rejects.toThrow("already used");
    await expect(auth.authenticate(rotated.access_token)).rejects.toThrow("revoked");
    const expired = await grant();
    await sql`update mcp_tokens set expires_at=now()-interval '1 second' where hash=${tokenDigest(expired.access_token)}`.execute(
      getDatabase(),
    );
    await expect(auth.authenticate(expired.access_token)).rejects.toThrow("expired");
  });
  it("checks scopes, current role, revocation and password changes", async () => {
    const read = await grant(["pushdocs:read"]),
      c = await client(read.access_token);
    try {
      await expect(
        c.callTool({
          name: "create_document",
          arguments: {
            projectId,
            branch: "main",
            path: "docs/no.md",
            content: "# No",
            expectedRevision: 0,
            idempotencyKey: "denied",
          },
        }),
      ).rejects.toThrow();
    } finally {
      await c.close();
    }
    const access = await grant();
    await getDatabase()
      .updateTable("project_memberships")
      .set({ role: "reader" })
      .where("user_id", "=", userId)
      .execute();
    const reader = await client(access.access_token);
    try {
      const state = await repo.getBranchState(projectId, "main");
      expect(
        (
          await reader.callTool({
            name: "create_document",
            arguments: {
              projectId,
              branch: "main",
              path: "docs/no.md",
              content: "# No",
              expectedRevision: state.changeSet?.revision ?? 0,
              idempotencyKey: "reader",
            },
          })
        ).isError,
      ).toBe(true);
    } finally {
      await reader.close();
      await getDatabase()
        .updateTable("project_memberships")
        .set({ role: "admin" })
        .where("user_id", "=", userId)
        .execute();
    }
    await auth.revokeGrant(access.principal.grantId, userId);
    await expect(auth.authenticate(access.access_token)).rejects.toThrow("revoked");
    const before = await grant();
    await getDatabase()
      .updateTable("users")
      .set({ password_hash: "new-hash" })
      .where("id", "=", userId)
      .execute();
    await expect(auth.authenticate(before.access_token)).rejects.toThrow("revoked");
  });
  it("invalidates a collaborative editor epoch after an external whole-file update", async () => {
    const room = await repo.exchangeDocument({
      projectId,
      branch: "main",
      path: "docs/other.md",
      userId,
    });
    const state = await repo.getBranchState(projectId, "main");
    await repo.stageFiles({
      projectId,
      branch: "main",
      userId,
      expectedRevision: state.changeSet?.revision ?? 0,
      files: [{ path: "docs/other.md", content: "# Changed by MCP" }],
    });
    const local = new Y.Doc();
    local.getText("source").insert(0, "stale browser content");
    await expect(
      repo.exchangeDocument({
        projectId,
        branch: "main",
        path: "docs/other.md",
        userId,
        epoch: room.epoch,
        update: Buffer.from(Y.encodeStateAsUpdate(local)).toString("base64"),
      }),
    ).rejects.toThrow("изменён вне");
    local.destroy();
  });
  it("checks bilingual spelling and ignores code, URLs and the project dictionary", async () => {
    const current = await repo.getBranchState(projectId, "main");
    await repo.stageFiles({
      projectId,
      branch: "main",
      userId,
      expectedRevision: current.changeSet?.revision ?? 0,
      files: [
        {
          path: "docs/spelling.md",
          content:
            '# Hello\n\nОшибкка and misspelld. Productword. https://example.invalid/unspellableurl\n\n`ignoreddword`\n\n```js\nignoreddword\n```\n\n<CustomThing value="ignoreddword">Hello world</CustomThing>',
        },
        {
          path: ".pushdocs/spelling.json",
          content: JSON.stringify({ ignoredWords: ["Productword"] }),
        },
      ],
    });
    const access = await grant(),
      c = await client(access.access_token);
    try {
      const checked = await c.callTool({
        name: "check_spelling",
        arguments: { projectId, branch: "main", path: "docs/spelling.md" },
      });
      expect(checked.isError).not.toBe(true);
      const result = checked.structuredContent as {
        issues: Array<{ word: string; start: number; end: number; suggestions: string[] }>;
        revisionToken: string;
        changeSetRevision: number;
      };
      expect(result.issues.map((i) => i.word)).toEqual(
        expect.arrayContaining(["Ошибкка", "misspelld"]),
      );
      expect(result.issues.map((i) => i.word)).not.toEqual(
        expect.arrayContaining(["Productword", "ignoreddword", "unspellableurl", "CustomThing"]),
      );
      const correction = result.issues.find((i) => i.word === "Ошибкка");
      if (!correction) throw new Error("Missing spelling issue");
      expect(
        (
          await c.callTool({
            name: "fix_spelling",
            arguments: {
              projectId,
              branch: "main",
              path: "docs/spelling.md",
              expectedRevision: result.changeSetRevision,
              revisionToken: result.revisionToken,
              idempotencyKey: "spelling-fix",
              corrections: [
                {
                  start: correction.start,
                  end: correction.end,
                  word: correction.word,
                  replacement: "Ошибка",
                },
              ],
            },
          })
        ).isError,
      ).not.toBe(true);
    } finally {
      await c.close();
    }
  }, 30_000);
  it("optimizes media through attachment staging, checks hashes and preserves already optimized files", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "pushdocs-mcp-media-"));
    vi.stubEnv("PUSHDOCS_ATTACHMENTS_DIR", directory);
    const pixels = Buffer.alloc(128 * 128 * 3);
    for (let i = 0; i < pixels.length; i++) pixels[i] = i % 251;
    const base = sharp(pixels, { raw: { width: 128, height: 128, channels: 3 } });
    const assets = new Map<string, Buffer>([
      ["static/img/pic.png", await base.clone().png({ compressionLevel: 0 }).toBuffer()],
      ["static/img/pic.jpg", await base.clone().jpeg({ quality: 100 }).toBuffer()],
      ["static/img/pic.webp", await base.clone().webp({ lossless: true }).toBuffer()],
      [
        "static/img/pic.svg",
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">   <rect width="100" height="100" fill="red"/>   </svg>',
        ),
      ],
      ["static/img/pic.gif", await base.clone().gif().toBuffer()],
    ]);
    vi.mocked(providerForConnection).mockResolvedValue({
      readBinary: vi.fn(async (_id, _sha, filePath) => {
        const bytes = assets.get(filePath);
        if (!bytes) throw new Error("Fixture image missing");
        return bytes;
      }),
    } as never);
    const state = await repo.getBranchState(projectId, "main");
    await getDatabase()
      .updateTable("branch_contexts")
      .set({
        repository_paths: JSON.stringify([...state.branch.repository_paths, ...assets.keys()]),
      })
      .where("id", "=", state.branch.id)
      .execute();
    await repo.stageFiles({
      projectId,
      branch: "main",
      userId,
      expectedRevision: state.changeSet?.revision ?? 0,
      files: [
        {
          path: "docs/images.md",
          content: [...assets.keys()].map((file) => `![image](/${file.slice(7)})`).join("\n\n"),
        },
      ],
    });
    const access = await grant(),
      c = await client(access.access_token);
    try {
      const listed = await c.callTool({
        name: "list_document_images",
        arguments: { projectId, branch: "main", path: "docs/images.md" },
      });
      expect(listed.isError).not.toBe(true);
      const result = listed.structuredContent as {
        images: Array<{ path: string; sha256: string }>;
        changeSetRevision: number;
      };
      expect(result.images.length).toBe(5);
      let expectedRevision = result.changeSetRevision;
      let changedCount = 0;
      for (const image of result.images.filter((i) => !i.path.endsWith(".gif"))) {
        const optimized = await c.callTool({
          name: "compress_image",
          arguments: {
            projectId,
            branch: "main",
            imagePath: image.path,
            expectedHash: image.sha256,
            expectedRevision,
            idempotencyKey: image.path,
            ...(!image.path.endsWith(".svg") ? { maxWidth: 64 } : {}),
          },
        });
        expect(optimized.isError).not.toBe(true);
        const output = optimized.structuredContent as {
          changed: boolean;
          changeSetRevision: number;
          savedBytes: number;
        };
        expect(output.savedBytes).toBeGreaterThanOrEqual(0);
        if (output.changed) changedCount++;
        expectedRevision = output.changeSetRevision;
      }
      const gif = result.images.find((i) => i.path.endsWith(".gif"));
      if (!gif) throw new Error("Missing GIF fixture");
      expect(
        (
          await c.callTool({
            name: "compress_image",
            arguments: {
              projectId,
              branch: "main",
              imagePath: gif.path,
              expectedHash: gif.sha256,
              expectedRevision,
              idempotencyKey: "gif-unsupported",
            },
          })
        ).isError,
      ).toBe(true);
      const updated = await c.callTool({
        name: "list_document_images",
        arguments: { projectId, branch: "main", path: "docs/images.md" },
      });
      const png = (updated.structuredContent as typeof result).images.find((i) =>
        i.path.endsWith(".png"),
      );
      if (!png) throw new Error("Missing PNG fixture");
      expect(
        (
          await c.callTool({
            name: "compress_image",
            arguments: {
              projectId,
              branch: "main",
              imagePath: png.path,
              expectedHash: png.sha256,
              expectedRevision,
              idempotencyKey: "keep-original",
              minSavingsPercent: 100,
            },
          })
        ).structuredContent,
      ).toMatchObject({ changed: false });
      expect(
        (
          await c.callTool({
            name: "compress_image",
            arguments: {
              projectId,
              branch: "main",
              imagePath: png.path,
              expectedHash: "0".repeat(64),
              expectedRevision,
              idempotencyKey: "hash-conflict",
            },
          })
        ).isError,
      ).toBe(true);
      expect((await repo.listPreviewAttachments(projectId, "main")).length).toBe(changedCount);
      expect(changedCount).toBeGreaterThan(0);
    } finally {
      await c.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
  it("lists preview inventory with read scope without starting sites", async () => {
    const access = await grant(["pushdocs:read"]);
    const c = await client(access.access_token);
    await repo.recordPreviewWorkspace(projectId, "main", {
      ready_at: new Date("2026-10-09T10:00:00Z"),
      startup_ms: 136_200,
      disk_bytes: 3_400_000_000,
    });
    try {
      const tools = await c.listTools();
      expect(tools.tools.find((t) => t.name === "list_previews")?.annotations?.readOnlyHint).toBe(
        true,
      );
      const result = await c.callTool({ name: "list_previews", arguments: { projectId } });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({
        total: 1,
        items: [
          {
            branch: "main",
            isDefault: true,
            status: "deployed",
            startupMs: 136_200,
            startupMinutes: 2.27,
            diskBytes: 3_400_000_000,
            changedFiles: expect.any(Number),
            expiresAt: null,
            url: null,
          },
        ],
      });
      expect(await repo.listPreviewSessions()).toEqual([]);
      const denied = await c.callTool({
        name: "list_previews",
        arguments: { projectId: randomUUID() },
      });
      expect(denied.isError).toBe(true);
    } finally {
      await c.close();
    }
  });
  it("keeps API state stopped when startup completion races with an explicit stop", async () => {
    vi.stubEnv("PUSHDOCS_PREVIEW_PUBLIC_HOST", "preview.test");
    const access = await grant(["pushdocs:read"]);
    const c = await client(access.access_token);
    const session = await repo.acquirePreview({
      projectId,
      branch: "main",
      userId,
      clientId: "browser",
      portFrom: 44000,
      portTo: 44010,
    });
    await repo.updatePreviewSession(session.id, { status: "starting" });
    try {
      await Promise.all([
        repo.completePreviewStartup(session.id, {
          headSha: "main-sha",
          revision: 0,
          startupMs: 123_000,
        }),
        repo.stopPreview(projectId, "main"),
      ]);
      expect((await repo.getPreviewSession(projectId, "main"))?.desired_state).toBe("stopped");
      const result = await c.callTool({
        name: "get_preview_status",
        arguments: { projectId, branch: "main" },
      });
      expect(result.isError).not.toBe(true);
      expect(result.structuredContent).toMatchObject({ status: "stopped", previewUrl: null });
      expect(
        await repo.completePreviewStartup(session.id, {
          headSha: "main-sha",
          revision: 0,
          startupMs: 1,
        }),
      ).toBe(false);
    } finally {
      await c.close();
    }
  });
  it("isolates agent and browser preview leases and expires revoked access", async () => {
    const access = await grant(),
      clientId = `mcp:${access.principal.grantId}`;
    const session = await repo.acquirePreview({
      projectId,
      branch: "main",
      userId,
      clientId,
      leaseTtlMs: 1_800_000,
      portFrom: 44000,
      portTo: 44010,
    });
    await repo.acquirePreview({
      projectId,
      branch: "main",
      userId,
      clientId: "browser",
      portFrom: 44000,
      portTo: 44010,
    });
    await repo.releasePreview(session.id, userId, clientId);
    expect((await repo.getPreviewSession(projectId, "main"))?.desired_state).toBe("running");
    await repo.acquirePreview({
      projectId,
      branch: "main",
      userId,
      clientId,
      leaseTtlMs: 1_800_000,
      portFrom: 44000,
      portTo: 44010,
    });
    await auth.revokeGrant(access.principal.grantId, userId);
    await repo.reconcilePreviewLeases();
    expect((await repo.getPreviewSession(projectId, "main"))?.desired_state).toBe("running");
    await sql`update preview_leases set expires_at=now()-interval '1 second' where session_id=${session.id}`.execute(
      getDatabase(),
    );
    await repo.reconcilePreviewLeases();
    expect((await repo.getPreviewSession(projectId, "main"))?.desired_state).toBe("running");
    await sql`update preview_leases set expires_at=now()-interval '2 hours' where session_id=${session.id}`.execute(
      getDatabase(),
    );
    await repo.reconcilePreviewLeases();
    expect((await repo.getPreviewSession(projectId, "main"))?.desired_state).toBe("stopped");
  });
});
