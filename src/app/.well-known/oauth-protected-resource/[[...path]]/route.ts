// RFC 9728 metadata (ADR-023). Catch-all on purpose: clients ask for it at the root AND at the endpoint
// path, and each connector must announce its own resource (#155 B1).

import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'

import { appUrl } from '@/lib/mcp/core/env'
import { MCP_PATH, MCP_PATHS, mcpResourceUrl, supabaseAuthIssuer } from '@/lib/mcp/core/routes'

export const runtime = 'nodejs'

// Same CORS as mcp-handler's metadata, so a browser client sees a clean 404 (review PR #162).
const NOT_FOUND_HEADERS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, OPTIONS', 'Access-Control-Allow-Headers': '*' }

type Params = { params: Promise<{ path?: string[] }> }

export async function GET(request: Request, { params }: Params) {
  const { path = [] } = await params
  // The bare root stays /api/mcp: it is what the first connector has always read.
  const mcpPath = path.length === 0 ? MCP_PATH : `/${path.join('/')}`
  if (!MCP_PATHS.includes(mcpPath)) return new Response('Not found', { status: 404, headers: NOT_FOUND_HEADERS })
  return protectedResourceHandler({
    authServerUrls: [supabaseAuthIssuer(process.env.NEXT_PUBLIC_SUPABASE_URL!)],
    resourceUrl: mcpResourceUrl(appUrl(), mcpPath),
  })(request)
}

export const OPTIONS = metadataCorsOptionsRequestHandler()
