/**
 * MCP env (ADR-023): validated at import so a bad value fails at boot, not silently.
 * APP_URL must be origin-only — a path breaks the resource identifier and the connector.
 */

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

/** Public app origin. Never taken from the Host header (spoofable). */
export function appUrl(): string {
  if (explicitAppUrl) return explicitAppUrl

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return 'http://localhost:3000'
}

/** OAuth client_id allowlist (CSV). Empty = any client of the project. */
export function allowedClientIds(): string[] {
  return (process.env.MCP_OAUTH_CLIENT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
}
