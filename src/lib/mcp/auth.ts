/**
 * Autenticación del endpoint MCP: un token compartido (`MCP_API_KEY`) enviado
 * como `Authorization: Bearer <token>`.
 *
 * El MCP usa el admin client de Supabase (service role, bypassa RLS), así que
 * este chequeo es la ÚNICA barrera de acceso — si `MCP_API_KEY` no está
 * configurada, el endpoint rechaza todo (nunca degrada a "sin auth").
 */

import { createHash, timingSafeEqual } from 'node:crypto'

/** Comparación en tiempo constante; el hash iguala longitudes. */
function safeEqual(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest()
  const hb = createHash('sha256').update(b).digest()
  return timingSafeEqual(ha, hb)
}

export function extractBearerToken(req: Request): string | null {
  const header = req.headers.get('authorization') ?? ''
  const match = header.match(/^Bearer\s+(.+)$/i)
  return match ? match[1].trim() : null
}

export function isValidMcpToken(token: string | null): boolean {
  const expected = process.env.MCP_API_KEY
  if (!expected || !token) return false
  return safeEqual(token, expected)
}

export function requireMcpAuth(
  handler: (req: Request) => Response | Promise<Response>,
): (req: Request) => Promise<Response> {
  return async (req) => {
    if (!isValidMcpToken(extractBearerToken(req))) {
      return Response.json(
        { message: 'No autorizado' },
        { status: 401, headers: { 'WWW-Authenticate': 'Bearer' } },
      )
    }
    return handler(req)
  }
}
