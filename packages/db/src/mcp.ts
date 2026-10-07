import { createHash, randomBytes } from "node:crypto";
import { type Kysely, sql, type Transaction } from "kysely";
import type { Database } from "./schema";

export const mcpScopes = [
  "pushdocs:read",
  "pushdocs:write",
  "pushdocs:preview",
  "pushdocs:submit",
] as const;
export const opaque = () => randomBytes(32).toString("base64url");
export const canonicalJson = (value: unknown) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === "object" && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b)))
      : item,
  );
export const tokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");
export const pkceChallenge = (verifier: string) =>
  createHash("sha256").update(verifier).digest("base64url");
export class McpError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export interface McpPrincipal {
  grantId: string;
  userId: string;
  clientId: string;
  scopes: string[];
  projects: string[];
}
export interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  resource: string;
  challenge: string;
  scopes: string[];
  state?: string;
}
interface GrantRow {
  id: string;
  user_id: string;
  client_id: string;
  scopes: string[];
  projects: string[];
  resource: string;
  security_stamp: string;
  revoked_at: Date | null;
}
export class McpRepository {
  constructor(readonly db: Kysely<Database>) {}
  private transaction<T>(run: (tx: Transaction<Database>) => Promise<T>) {
    return this.db.isTransaction
      ? run(this.db as Transaction<Database>)
      : this.db.transaction().execute(run);
  }
  async rateLimit(key: string, limit: number, windowMs = 60_000) {
    const now = new Date();
    const cutoff = new Date(now.getTime() - windowMs);
    const { rows } = await sql<{ count: number }>`insert into mcp_rate_limits(key,window_at,count)
      values(${key},${now},1) on conflict(key) do update set
      count = case when mcp_rate_limits.window_at < ${cutoff} then 1 else mcp_rate_limits.count+1 end,
      window_at = case when mcp_rate_limits.window_at < ${cutoff} then ${now} else mcp_rate_limits.window_at end
      returning count`.execute(this.db);
    if ((rows[0]?.count ?? limit + 1) > limit)
      throw new McpError("RATE_LIMITED", "Too many requests. Retry later.", 429);
  }
  async registerClient(name: string, redirectUris: string[]) {
    const id = opaque();
    await sql`insert into mcp_clients(id,name,redirect_uris) values(${id},${name},${JSON.stringify(redirectUris)}::jsonb)`.execute(
      this.db,
    );
    return id;
  }
  async client(id: string) {
    return (
      await sql<{
        id: string;
        name: string;
        redirect_uris: string[];
      }>`select id,name,redirect_uris from mcp_clients where id=${id}`.execute(this.db)
    ).rows[0];
  }
  async consent(userId: string, request: AuthorizationRequest) {
    const nonce = opaque();
    await sql`delete from mcp_consents where expires_at < now()`.execute(this.db);
    await sql`insert into mcp_consents(hash,user_id,request,expires_at)
      values(${tokenDigest(nonce)},${userId},${JSON.stringify(request)}::jsonb,${new Date(Date.now() + 600_000)})`.execute(
      this.db,
    );
    return nonce;
  }
  async consentRequest(userId: string, nonce: string) {
    return (
      await sql<{ request: AuthorizationRequest }>`select request from mcp_consents
      where hash=${tokenDigest(nonce)} and user_id=${userId} and expires_at > now()`.execute(
        this.db,
      )
    ).rows[0]?.request;
  }
  async authorize(userId: string, nonce: string, projects: string[], approved = true) {
    return this.transaction(async (tx) => {
      const request = (
        await sql<{ request: AuthorizationRequest }>`delete from mcp_consents
        where hash=${tokenDigest(nonce)} and user_id=${userId} and expires_at > now() returning request`.execute(
          tx,
        )
      ).rows[0]?.request;
      if (!request)
        throw new McpError("invalid_request", "Consent expired. Start authorization again.");
      if (!approved) return { code: null, request };
      if (!projects.length || projects.length > 100)
        throw new McpError("invalid_request", "Select at least one project.");
      const memberships = await tx
        .selectFrom("project_memberships")
        .select("project_id")
        .where("user_id", "=", userId)
        .where("project_id", "in", projects)
        .execute();
      if (new Set(memberships.map((m) => m.project_id)).size !== new Set(projects).size)
        throw new McpError("access_denied", "Project access changed.", 403);
      const user = await tx
        .selectFrom("users")
        .select(["password_hash", "totp_secret"])
        .where("id", "=", userId)
        .where("status", "=", "active")
        .executeTakeFirstOrThrow();
      const grant = (
        await sql<{
          id: string;
        }>`insert into mcp_grants(user_id,client_id,scopes,projects,resource,security_stamp)
        values(${userId},${request.clientId},${JSON.stringify(request.scopes)}::jsonb,${JSON.stringify([...new Set(projects)])}::jsonb,${request.resource},
          ${tokenDigest(user.password_hash + (user.totp_secret ?? ""))}) returning id`.execute(tx)
      ).rows[0];
      if (!grant) throw new Error("Grant creation failed");
      const code = opaque();
      await sql`insert into mcp_codes(hash,grant_id,redirect_uri,challenge,resource,expires_at)
        values(${tokenDigest(code)},${grant.id},${request.redirectUri},${request.challenge},${request.resource},${new Date(Date.now() + 120_000)})`.execute(
        tx,
      );
      return { code, request };
    });
  }
  private async issue(db: Kysely<Database>, grantId: string) {
    const access = opaque(),
      refresh = opaque();
    await sql`insert into mcp_tokens(hash,grant_id,kind,expires_at) values
      (${tokenDigest(access)},${grantId},'access',${new Date(Date.now() + 900_000)}),
      (${tokenDigest(refresh)},${grantId},'refresh',${new Date(Date.now() + 30 * 86400_000)})`.execute(
      db,
    );
    return { access_token: access, refresh_token: refresh, expires_in: 900, token_type: "Bearer" };
  }
  async exchange(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    verifier: string;
    resource: string;
  }) {
    return this.transaction(async (tx) => {
      const row = (
        await sql<{
          grant_id: string;
          challenge: string;
          redirect_uri: string;
          resource: string;
          consumed_at: Date | null;
          expires_at: Date;
        }>`select * from mcp_codes where hash=${tokenDigest(input.code)} for update`.execute(tx)
      ).rows[0];
      if (
        !row ||
        row.consumed_at ||
        row.expires_at <= new Date() ||
        row.redirect_uri !== input.redirectUri ||
        row.resource !== input.resource ||
        !/^[A-Za-z0-9._~-]{43,128}$/.test(input.verifier) ||
        pkceChallenge(input.verifier) !== row.challenge
      )
        throw new McpError("invalid_grant", "Invalid or expired authorization code.");
      const grant = await this.activeGrant(tx, row.grant_id);
      if (!grant || grant.client_id !== input.clientId)
        throw new McpError("invalid_grant", "Authorization is no longer valid.");
      await sql`update mcp_codes set consumed_at=now() where hash=${tokenDigest(input.code)}`.execute(
        tx,
      );
      return { ...(await this.issue(tx, grant.id)), scope: grant.scopes.join(" ") };
    });
  }
  private async activeGrant(db: Kysely<Database>, id: string) {
    return (
      await sql<GrantRow>`select g.* from mcp_grants g join users u on u.id=g.user_id
      where g.id=${id} and g.revoked_at is null and g.created_at > now() - interval '30 days' and u.status='active'
      and g.security_stamp=encode(digest(u.password_hash || coalesce(u.totp_secret,''),'sha256'),'hex')`.execute(
        db,
      )
    ).rows[0];
  }
  async refresh(token: string, clientId: string, requestedScopes?: string[]) {
    const result = await this.transaction(async (tx) => {
      const row = (
        await sql<{
          grant_id: string;
          consumed_at: Date | null;
          expires_at: Date;
        }>`select * from mcp_tokens where hash=${tokenDigest(token)} and kind='refresh' for update`.execute(
          tx,
        )
      ).rows[0];
      if (!row) return null;
      const grant = await this.activeGrant(tx, row.grant_id);
      if (!grant || grant.client_id !== clientId) return null;
      if (row.consumed_at) {
        await this.revokeGrant(grant.id, grant.user_id, tx);
        return null; // Commit family revocation even though the request fails.
      }
      if (row.expires_at <= new Date()) return null;
      if (
        requestedScopes &&
        (requestedScopes.length !== grant.scopes.length ||
          requestedScopes.some((s) => !grant.scopes.includes(s)))
      )
        throw new McpError("invalid_scope", "Changing scopes requires authorization again.");
      await sql`update mcp_tokens set consumed_at=now() where hash=${tokenDigest(token)}`.execute(
        tx,
      );
      return { ...(await this.issue(tx, grant.id)), scope: grant.scopes.join(" ") };
    });
    if (!result)
      throw new McpError("invalid_grant", "Refresh token expired, revoked or already used.");
    return result;
  }
  async authenticate(token: string, resource?: string): Promise<McpPrincipal> {
    const row = (
      await sql<{
        grant_id: string;
      }>`select grant_id from mcp_tokens where hash=${tokenDigest(token)} and kind='access' and consumed_at is null and expires_at > now()`.execute(
        this.db,
      )
    ).rows[0];
    const grant = row && (await this.activeGrant(this.db, row.grant_id));
    if (!grant || (resource && grant.resource !== resource))
      throw new McpError("invalid_token", "Access token expired or revoked.", 401);
    return {
      grantId: grant.id,
      userId: grant.user_id,
      clientId: grant.client_id,
      scopes: grant.scopes,
      projects: grant.projects,
    };
  }
  async requireGrant(id: string, userId: string, projectId: string, scope: string) {
    const grant = await this.activeGrant(this.db, id);
    if (
      !grant ||
      grant.user_id !== userId ||
      !grant.projects.includes(projectId) ||
      !grant.scopes.includes(scope)
    )
      throw new McpError(
        "PERMISSION_DENIED",
        "OAuth authorization was revoked or does not allow this operation.",
        403,
      );
  }
  async revokeToken(token: string, clientId: string) {
    const row = (
      await sql<{
        id: string;
        user_id: string;
      }>`select g.id,g.user_id from mcp_grants g join mcp_tokens t on t.grant_id=g.id where t.hash=${tokenDigest(token)} and g.client_id=${clientId}`.execute(
        this.db,
      )
    ).rows[0];
    if (row) await this.revokeGrant(row.id, row.user_id);
  }
  async revokeGrant(id: string, userId: string, db = this.db) {
    await sql`update mcp_grants set revoked_at=now() where id=${id} and user_id=${userId}`.execute(
      db,
    );
    await sql`delete from preview_leases where user_id=${userId} and client_id=${`mcp:${id}`}`.execute(
      db,
    );
  }
  async grants(userId: string) {
    return (
      await sql<{
        id: string;
        name: string;
        scopes: string[];
        projects: string[];
        created_at: Date;
      }>`select g.id,c.name,g.scopes,g.projects,g.created_at from mcp_grants g join mcp_clients c on c.id=g.client_id where g.user_id=${userId} and g.revoked_at is null order by g.created_at desc`.execute(
        this.db,
      )
    ).rows;
  }
  async audit(
    principal: McpPrincipal,
    tool: string,
    input: Record<string, unknown>,
    detail: Record<string, unknown>,
  ) {
    const projectId =
      typeof input.projectId === "string" && principal.projects.includes(input.projectId)
        ? input.projectId
        : null;
    await sql`insert into mcp_audit(grant_id,tool,project_id,branch,detail)
      values(${principal.grantId},${tool},${projectId},${input.branch ?? input.branchName ?? null},${canonicalJson(detail)}::jsonb)`.execute(
      this.db,
    );
  }
  async write(
    principal: McpPrincipal,
    tool: string,
    input: Record<string, unknown>,
    run: (db: Transaction<Database>) => Promise<unknown>,
  ) {
    const key = String(input.idempotencyKey ?? "");
    if (!key || key.length > 200)
      throw new McpError(
        "INVALID_ARGUMENT",
        "An idempotencyKey of 1 to 200 characters is required.",
      );
    const digest = tokenDigest(canonicalJson({ tool, input }));
    return this.transaction(async (tx) => {
      // Serialize retries of this key, without serializing unrelated calls.
      await sql`select pg_advisory_xact_lock(hashtextextended(${`${principal.grantId}:${key}`},0))`.execute(
        tx,
      );
      if (!(await this.activeGrant(tx, principal.grantId)))
        throw new McpError("invalid_token", "Authorization revoked.", 401);
      const old = (
        await sql<{
          digest: string;
          result: unknown;
        }>`select digest,result from mcp_calls where grant_id=${principal.grantId} and request_key=${key}`.execute(
          tx,
        )
      ).rows[0];
      if (old) {
        if (old.digest !== digest)
          throw new McpError(
            "IDEMPOTENCY_KEY_REUSED",
            "Use a new key for different arguments.",
            409,
          );
        await new McpRepository(tx).audit(principal, tool, input, { status: "replayed" });
        return old.result;
      }
      const result = await run(tx);
      const affectedFiles = [
        ...(result &&
        typeof result === "object" &&
        "affectedFiles" in result &&
        Array.isArray(result.affectedFiles)
          ? result.affectedFiles
          : []),
        input.path,
        input.imagePath,
        ...(Array.isArray(input.images)
          ? input.images.map((image: { path?: unknown }) => image.path)
          : []),
      ].filter((p) => typeof p === "string");
      const summary =
        result && typeof result === "object"
          ? Object.fromEntries(
              Object.entries(result).filter(([key]) =>
                [
                  "operationId",
                  "changeSetId",
                  "revision",
                  "changeSetRevision",
                  "status",
                  "changed",
                ].includes(key),
              ),
            )
          : {};
      await new McpRepository(tx).audit(principal, tool, input, {
        status: "succeeded",
        affectedFiles,
        ...summary,
      });
      await sql`insert into mcp_calls(grant_id,request_key,digest,tool,project_id,branch,result)
        values(${principal.grantId},${key},${digest},${tool},${input.projectId ?? null},${input.branch ?? null},${JSON.stringify(result)}::jsonb)`.execute(
        tx,
      );
      return result;
    });
  }
}
