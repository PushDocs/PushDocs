import { mcpScopes } from "@pushdocs/db";
import { publicOrigin } from "@/lib/mcp/oauth";
export function GET() {
  const origin = publicOrigin();
  return Response.json({
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize`,
    token_endpoint: `${origin}/oauth/token`,
    registration_endpoint: `${origin}/oauth/register`,
    revocation_endpoint: `${origin}/oauth/revoke`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: mcpScopes,
    authorization_response_iss_parameter_supported: true,
  });
}

export const dynamic = "force-dynamic";
