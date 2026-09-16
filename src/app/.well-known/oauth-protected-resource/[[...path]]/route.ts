// RFC 9728 metadata (ADR-023). Catch-all on purpose: clients ask for it at the root AND at .../api/mcp.

import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler'

import { appUrl } from '@/lib/mcp/env'
import { mcpResourceUrl, supabaseAuthIssuer } from '@/lib/mcp/routes'

export const runtime = 'nodejs'

export const GET = (request: Request) =>
  protectedResourceHandler({
    authServerUrls: [supabaseAuthIssuer(process.env.NEXT_PUBLIC_SUPABASE_URL!)],
    resourceUrl: mcpResourceUrl(appUrl()),
  })(request)

export const OPTIONS = metadataCorsOptionsRequestHandler()
