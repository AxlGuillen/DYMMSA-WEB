/**
 * Metadata del recurso protegido (RFC 9728, ADR-023). Es lo que el 401 de
 * /api/mcp anuncia en WWW-Authenticate para que el cliente MCP descubra el
 * authorization server (el OAuth nativo de Supabase).
 *
 * Catch-all OPCIONAL a propósito: los clientes piden el metadata tanto en la
 * raíz como en /.well-known/oauth-protected-resource/api/mcp; una ruta fija
 * solo respondería a una de las dos. Ambas devuelven el mismo documento.
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
