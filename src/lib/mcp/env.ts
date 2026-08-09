/**
 * Entorno del MCP remoto (ADR-023). Valida al importarse: si una variable está
 * mal formada el build/boot falla ruidosamente con un mensaje accionable, no
 * con un fallo silencioso en producción.
 *
 * - `APP_URL` es OPCIONAL: si falta se deriva de `VERCEL_PROJECT_PRODUCTION_URL`
 *   (Vercel la inyecta sola, también en previews apuntando a producción — eso
 *   hace estable el identificador del recurso entre deploys) y en local cae a
 *   http://localhost:3000. Debe ser SOLO el origen: pegarle una ruta produciría
 *   un identificador de recurso tipo `.../login/api/mcp` y el conector fallaría
 *   con un error que no menciona la causa.
 * - `MCP_OAUTH_CLIENT_IDS` (CSV) es el allowlist de clientes OAuth. Vacío =
 *   acepta cualquier cliente registrado en el proyecto Supabase.
 */

/** Lanza con mensaje accionable si APP_URL trae ruta/query/hash o no es URL. */
function validateOrigin(value: string): string {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error(
      `APP_URL no es una URL válida: "${value}". ` +
        'Debe ser solo el origen (https://tu-app.com). ' +
        'Corrígela en Vercel → Settings → Environment Variables (o .env.local).',
    )
  }
  const hasPath = url.pathname.replace(/\/+$/, '') !== ''
  if (hasPath || url.search || url.hash) {
    throw new Error(
      `APP_URL debe ser solo el origen, sin ruta ni query: "${value}". ` +
        'Ejemplo válido: https://dymmsa-web.vercel.app — no https://dymmsa-web.vercel.app/login. ' +
        'Corrígela en Vercel → Settings → Environment Variables (o .env.local).',
    )
  }
  return url.origin
}

const explicitAppUrl = process.env.APP_URL ? validateOrigin(process.env.APP_URL) : null

/** Origen público de la app. Nunca sale del header Host (spoofeable). */
export function appUrl(): string {
  if (explicitAppUrl) return explicitAppUrl

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return 'http://localhost:3000'
}

/** Allowlist de client_id OAuth (CSV). Vacío = cualquier cliente del proyecto. */
export function allowedClientIds(): string[] {
  return (process.env.MCP_OAUTH_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}
