import {
  type AuthorizationRequest,
  getDatabase,
  McpError,
  McpRepository,
  mcpScopes,
} from "@pushdocs/db";
import { z } from "zod";
import { readJsonBody } from "@/lib/request-body";
import { optionalUser, repository } from "@/lib/server";
import { consentFailure, consentPage } from "./consent-page";
import { oauthResumeCookie } from "./resume";

export function mcpStore() {
  return new McpRepository(getDatabase());
}
export function publicOrigin() {
  const value = process.env.PUSHDOCS_PUBLIC_ORIGIN;
  if (!value) throw new Error("PUSHDOCS_PUBLIC_ORIGIN is required for MCP");
  const url = new URL(value);
  if (
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    url.username ||
    url.password ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new Error("Invalid public origin");
  return url.origin;
}
export function resourceUri() {
  return `${publicOrigin()}/mcp`;
}
export function assertMcpOrigin(request: Request, required = false) {
  const origin = request.headers.get("origin");
  if ((required && !origin) || (origin && origin !== publicOrigin()))
    throw new McpError("INVALID_ORIGIN", "Origin is not allowed.", 403);
}
export function oauthError(error: unknown) {
  const known = error instanceof McpError;
  return Response.json(
    {
      error: known ? error.code : "invalid_request",
      error_description: known ? error.message : "Invalid request.",
    },
    { status: known ? error.status : 400, headers: { "Cache-Control": "no-store" } },
  );
}
export async function formBody(request: Request) {
  const value = await readJsonBody(
    new Request(request.url, { method: "POST", body: JSON.stringify(await boundedForm(request)) }),
    32_768,
  );
  return value as Record<string, string>;
}
async function boundedText(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/x-www-form-urlencoded"))
    throw new McpError("invalid_request", "Expected form encoding.");
  if (!request.body) throw new McpError("invalid_request", "Empty body.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > 32_768) throw new McpError("invalid_request", "Request too large.");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
  return Buffer.concat(chunks).toString();
}
async function boundedForm(request: Request) {
  const parameters = new URLSearchParams(await boundedText(request));
  for (const key of parameters.keys())
    if (parameters.getAll(key).length !== 1)
      throw new McpError("invalid_request", "Duplicate parameter.");
  return Object.fromEntries(parameters);
}
export function validateRedirect(uri: string) {
  const url = new URL(uri);
  if (
    url.username ||
    url.password ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)))
  )
    throw new McpError("invalid_redirect_uri", "HTTPS or a loopback callback is required.");
  return uri;
}
export async function register(request: Request) {
  try {
    assertMcpOrigin(request);
    await mcpStore().rateLimit("oauth:register", 30, 3_600_000);
    const input = z
      .object({
        client_name: z.string().min(1).max(100).default("MCP client"),
        redirect_uris: z.array(z.string().url().max(2000)).min(1).max(10),
        token_endpoint_auth_method: z.literal("none").default("none"),
        grant_types: z
          .array(z.enum(["authorization_code", "refresh_token"]))
          .default(["authorization_code", "refresh_token"]),
        response_types: z.array(z.literal("code")).default(["code"]),
      })
      .parse(await readJsonBody(request, 32_768));
    input.redirect_uris.forEach(validateRedirect);
    const id = await mcpStore().registerClient(input.client_name, input.redirect_uris);
    return Response.json(
      { ...input, client_id: id, client_id_issued_at: Math.floor(Date.now() / 1000) },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return oauthError(error);
  }
}
export async function authorizeGet(request: Request) {
  try {
    const query = new URL(request.url).searchParams;
    for (const key of query.keys())
      if (query.getAll(key).length !== 1)
        throw new McpError("invalid_request", "Duplicate parameter.");
    const clientId = query.get("client_id") ?? "";
    const client = await mcpStore().client(clientId);
    const redirectUri = query.get("redirect_uri") ?? "";
    if (!client?.redirect_uris.includes(redirectUri))
      throw new McpError("invalid_request", "Unknown client or redirect URI.");
    if (
      query.get("response_type") !== "code" ||
      query.get("code_challenge_method") !== "S256" ||
      !/^[A-Za-z0-9_-]{43}$/.test(query.get("code_challenge") ?? "")
    )
      throw new McpError("invalid_request", "Authorization Code with PKCE S256 is required.");
    if (query.get("resource") !== resourceUri())
      throw new McpError("invalid_target", "Invalid resource.");
    const scopes = (query.get("scope") || "pushdocs:read").split(/\s+/);
    if (scopes.some((s) => !mcpScopes.includes(s as (typeof mcpScopes)[number])))
      throw new McpError("invalid_scope", "Unknown scope.");
    const user = await optionalUser();
    if (!user) {
      const resume = `/oauth/authorize?${query.toString()}`;
      if (resume.length > 3500)
        throw new McpError("invalid_request", "Authorization request is too large.");
      return new Response(null, {
        status: 303,
        headers: {
          Location: `${publicOrigin()}/login`,
          "Cache-Control": "no-store",
          "Set-Cookie": `${oauthResumeCookie}=${encodeURIComponent(resume)}; Path=/; Max-Age=600; HttpOnly; SameSite=Lax${publicOrigin().startsWith("https:") ? "; Secure" : ""}`,
        },
      });
    }
    await mcpStore().rateLimit(`oauth:authorize:${user.id}`, 30);
    const auth: AuthorizationRequest = {
      clientId,
      redirectUri,
      resource: resourceUri(),
      challenge: query.get("code_challenge") ?? "",
      scopes: [...new Set(scopes)],
      state: query.get("state") ?? undefined,
    };
    const nonce = await mcpStore().consent(user.id, auth);
    const projects = await repository().listProjects(user.id);
    return consentPage({
      clientName: client.name,
      userName: user.displayName,
      nonce,
      scopes: auth.scopes,
      redirectUri,
      projects,
    });
  } catch {
    return consentFailure(
      "Не удалось открыть запрос на подключение. Вернитесь в приложение и начните подключение заново.",
    );
  }
}
export async function authorizePost(request: Request) {
  try {
    assertMcpOrigin(request, true);
    const form = new URLSearchParams(await boundedText(request));
    if (
      form.getAll("nonce").length !== 1 ||
      form.getAll("decision").length !== 1 ||
      !["allow", "deny"].includes(form.get("decision") ?? "")
    )
      return consentFailure(
        "Форма отправлена некорректно. Вернитесь в приложение и начните подключение заново.",
      );
    const user = await optionalUser();
    if (!user)
      return consentFailure(
        "Сессия PushDocs завершилась. Войдите в PushDocs, затем начните подключение из приложения заново.",
        401,
      );
    await mcpStore().rateLimit(`oauth:decision:${user.id}`, 30);
    const nonce = form.get("nonce") ?? "";
    const pending = await mcpStore().consentRequest(user.id, nonce);
    if (!pending)
      return consentFailure(
        "Эта форма уже использована или срок её действия истёк. Вернитесь в приложение и начните подключение заново.",
      );
    const selected = form.getAll("projects");
    if (form.get("decision") === "allow" && !selected.length) {
      const client = await mcpStore().client(pending.clientId);
      return consentPage({
        clientName: client?.name ?? "Приложение",
        userName: user.displayName,
        nonce,
        scopes: pending.scopes,
        redirectUri: pending.redirectUri,
        projects: await repository().listProjects(user.id),
        error: "Выберите хотя бы один проект, к которому хотите предоставить доступ.",
      });
    }
    const { code, request: auth } = await mcpStore().authorize(
      user.id,
      nonce,
      selected,
      form.get("decision") === "allow",
    );
    const url = new URL(auth.redirectUri);
    if (code) url.searchParams.set("code", code);
    else url.searchParams.set("error", "access_denied");
    url.searchParams.set("iss", publicOrigin());
    if (auth.state !== undefined) url.searchParams.set("state", auth.state);
    return Response.redirect(url.toString(), 303);
  } catch (error) {
    return consentFailure(
      error instanceof McpError && error.code === "INVALID_ORIGIN"
        ? "Форма отправлена с другого адреса. Начните подключение заново из приложения."
        : "Не удалось подтвердить доступ. Вернитесь в приложение и начните подключение заново.",
      error instanceof McpError ? error.status : 400,
    );
  }
}

export async function token(request: Request) {
  try {
    assertMcpOrigin(request);
    await mcpStore().rateLimit("oauth:token", 300);
    const form = await formBody(request);
    if (form.resource !== resourceUri()) throw new McpError("invalid_target", "Invalid resource.");
    let result: unknown;
    if (form.grant_type === "authorization_code")
      result = await mcpStore().exchange({
        code: form.code ?? "",
        clientId: form.client_id ?? "",
        redirectUri: form.redirect_uri ?? "",
        verifier: form.code_verifier ?? "",
        resource: form.resource,
      });
    else if (form.grant_type === "refresh_token")
      result = await mcpStore().refresh(
        form.refresh_token ?? "",
        form.client_id ?? "",
        form.scope?.split(/\s+/),
      );
    else throw new McpError("unsupported_grant_type", "Unsupported grant type.");
    return Response.json(result, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return oauthError(error);
  }
}
export async function revoke(request: Request) {
  try {
    assertMcpOrigin(request);
    await mcpStore().rateLimit("oauth:revoke", 120);
    const form = await formBody(request);
    await mcpStore().revokeToken(form.token ?? "", form.client_id ?? "");
    return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return oauthError(error);
  }
}
