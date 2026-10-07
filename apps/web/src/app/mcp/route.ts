import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { McpError } from "@pushdocs/db";
import { assertMcpOrigin, mcpStore, publicOrigin, resourceUri } from "@/lib/mcp/oauth";
import { createMcpServer, scopeForTool } from "@/lib/mcp/tools";
import { readJsonBody } from "@/lib/request-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    assertMcpOrigin(request);
    const header = request.headers.get("authorization");
    if (!header?.startsWith("Bearer ") || header.length > 2000)
      throw new McpError("invalid_token", "Bearer access token required.", 401);
    const principal = await mcpStore().authenticate(header.slice(7), resourceUri());
    await mcpStore().rateLimit(`mcp:requests:${principal.grantId}`, 240);
    const body = await readJsonBody(request, 8_000_000);
    if (
      body &&
      typeof body === "object" &&
      "method" in body &&
      body.method === "tools/call" &&
      "params" in body &&
      body.params &&
      typeof body.params === "object" &&
      "name" in body.params &&
      typeof body.params.name === "string"
    ) {
      const scope = scopeForTool(body.params.name);
      if (scope && !principal.scopes.includes(scope))
        return Response.json(
          { error: "insufficient_scope" },
          {
            status: 403,
            headers: {
              "Cache-Control": "no-store",
              "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}", resource_metadata="${publicOrigin()}/.well-known/oauth-protected-resource"`,
            },
          },
        );
    }
    const server = createMcpServer(principal);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    try {
      return await transport.handleRequest(request, { parsedBody: body });
    } finally {
      await server.close();
    }
  } catch (error) {
    const known = error instanceof McpError,
      status = known ? error.status : 400;
    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (status === 401)
      headers["WWW-Authenticate"] =
        `Bearer resource_metadata="${publicOrigin()}/.well-known/oauth-protected-resource", scope="pushdocs:read", error="invalid_token"`;
    return Response.json({ error: known ? error.code : "invalid_request" }, { status, headers });
  }
}
export function GET() {
  return new Response(null, { status: 405, headers: { Allow: "POST" } });
}
export const DELETE = GET;
