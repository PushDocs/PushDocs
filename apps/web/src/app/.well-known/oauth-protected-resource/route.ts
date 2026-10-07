import { mcpScopes } from "@pushdocs/db";
import { publicOrigin, resourceUri } from "@/lib/mcp/oauth";
export function GET() {
  return Response.json({
    resource: resourceUri(),
    authorization_servers: [publicOrigin()],
    scopes_supported: mcpScopes,
    bearer_methods_supported: ["header"],
  });
}

export const dynamic = "force-dynamic";
