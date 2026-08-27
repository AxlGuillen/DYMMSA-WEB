/**
 * Metadata RFC 9728 (ADR-023) — lo que el 401 anuncia en WWW-Authenticate.
 * Catch-all a propósito: los clientes lo piden en la raíz Y en .../api/mcp.
 */

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
