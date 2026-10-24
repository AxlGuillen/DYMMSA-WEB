/** MCP route constants (ADR-023), safe on client and server. */

export const MCP_PATH = '/api/mcp'

/** The Odoo DYMMSA connector (#155 B1, ADR-041): same app, same OAuth, its own endpoint. */
export const ODOO_MCP_PATH = '/api/odoo/mcp'

/** Every MCP endpoint this app serves; anything else gets no protected-resource metadata. */
export const MCP_PATHS: readonly string[] = [MCP_PATH, ODOO_MCP_PATH]

/** RFC 9728. Announced by the 401 so the client can discover the authorization server. */
export const PROTECTED_RESOURCE_PATH = '/.well-known/oauth-protected-resource'

/** Metadata path of an endpoint: /api/mcp keeps the root one it has always announced (ADR-023). */
export function protectedResourcePath(mcpPath: string): string {
  return mcpPath === MCP_PATH ? PROTECTED_RESOURCE_PATH : `${PROTECTED_RESOURCE_PATH}${mcpPath}`
}

/** Resource identifier. The origin comes from appUrl(), never the Host header. */
export function mcpResourceUrl(origin: string, mcpPath: string = MCP_PATH): string {
  return `${origin.replace(/\/+$/, '')}${mcpPath}`
}

/** Supabase OAuth issuer; matches the `iss` claim of its tokens. */
export function supabaseAuthIssuer(supabaseUrl: string): string {
  return `${supabaseUrl.replace(/\/+$/, '')}/auth/v1`
}
