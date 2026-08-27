/**
 * Env del MCP (ADR-023): valida al importar — mal formado truena en boot, no en
 * silencio. APP_URL opcional (deriva de Vercel) y SOLO el origen: con ruta el
 * identificador del recurso queda roto y el conector falla sin decir por qué.
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
