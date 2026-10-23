/** MCP route constants (ADR-023), safe on client and server. */

export const MCP_PATH = '/api/mcp'

/** RFC 9728. Announced by the 401 so the client can discover the authorization server. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource'

/** Resource identifier. The origin comes from appUrl(), never the Host header. */
export function mcpResourceUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}${MCP_PATH}`
}

/** Supabase OAuth issuer; matches the `iss` claim of its tokens. */
export function supabaseAuthIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
}
