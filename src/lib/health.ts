/**
 * Health checks de la aplicación — lógica pura del endpoint público GET /api/health.
 *
 * Contrato (pensado para reutilizarse en todos los proyectos):
 *   - status global: ok | degraded | down  →  HTTP 200 | 200 | 503
 *   - `down` solo por fallas que impiden operar (BD, páginas); `degraded` por
 *     dependencias secundarias (GitHub/Tareas, Storage).
 *   - Respuestas GRUESAS: el endpoint es público, así que nunca se exponen
 *     mensajes de error internos ni nombres de env vars — solo ok/fail/skip.
 *
 * Cada check está aislado (una dependencia caída no tumba a las demás) y las
 * dependencias (db, fetch) se inyectan para testear con stubs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getGitHubConfig } from '@/lib/github'

export type CheckStatus = 'ok' | 'fail' | 'skip'

export interface HealthCheck {
  status: CheckStatus
  latency_ms?: number
  detail?: string
}

export interface PagesCheck extends HealthCheck {
  pages: Record<string, CheckStatus>
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down'
  app: string
  version: string | null
  timestamp: string
  checks: {
    database: HealthCheck
    storage: HealthCheck
    github: HealthCheck
    pages: PagesCheck
  }
}

type Fetcher = typeof fetch

const CHECK_TIMEOUT_MS = 5000

// ─── Checks individuales ───────────────────────────────────────────────

/** Query real a la BD (conexión + service role + red), con latencia. */
export async function checkDatabase(db: SupabaseClient): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const { error } = await db.from('quotations').select('id').limit(1)
    if (error) return { status: 'fail' }
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch {
    return { status: 'fail' }
  }
}

/** El bucket de imágenes de Tareas responde (Storage vivo). */
export async function checkStorage(db: SupabaseClient): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const { error } = await db.storage.from('task-images').list('', { limit: 1 })
    if (error) {
      // El body público es grueso; el porqué va al server log.
      console.error('Health storage check failed:', error)
      return { status: 'fail' }
    }
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e) {
    console.error('Health storage check threw:', e)
    return { status: 'fail' }
  }
}

/**
 * El token de GitHub (módulo Tareas) sigue válido. /rate_limit no consume
 * cuota. Sin configuración → skip (entorno local sin el módulo).
 */
export async function checkGitHub(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  const cfg = getGitHubConfig()
  if (!cfg) return { status: 'skip', detail: 'no configurado' }
  try {
    const res = await fetchFn('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    return res.ok ? { status: 'ok' } : { status: 'fail' }
  } catch {
    return { status: 'fail' }
  }
}

/**
 * Rutas clave accesibles vía self-fetch. Expectativas estrictas:
 *   /login     → 200 (página pública renderiza)
 *   /          → 3xx (redirige según sesión)
 *   /dashboard → 3xx SIN sesión — un 200 aquí significaría guard de auth roto,
 *                y eso también es una falla que queremos detectar.
 */
const PAGE_EXPECTATIONS: { path: string; expect: 'ok' | 'redirect' }[] = [
  { path: '/login', expect: 'ok' },
  { path: '/', expect: 'redirect' },
  { path: '/dashboard', expect: 'redirect' },
]

export async function checkPages(origin: string, fetchFn: Fetcher = fetch): Promise<PagesCheck> {
  const results = await Promise.all(
    PAGE_EXPECTATIONS.map(async ({ path, expect }): Promise<[string, CheckStatus]> => {
      try {
        const res = await fetchFn(`${origin}${path}`, {
          redirect: 'manual',
          headers: { 'user-agent': 'dymmsa-health-check' },
          signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
        })
        const pass =
          expect === 'ok' ? res.status === 200 : res.status >= 300 && res.status < 400
        return [path, pass ? 'ok' : 'fail']
      } catch {
        return [path, 'fail']
      }
    }),
  )

  const pages = Object.fromEntries(results) as Record<string, CheckStatus>
  const allOk = results.every(([, s]) => s === 'ok')
  return { status: allOk ? 'ok' : 'fail', pages }
}

// ─── Agregación ────────────────────────────────────────────────────────

export async function runHealthChecks(deps: {
  db: SupabaseClient
  origin: string
  fetchFn?: Fetcher
}): Promise<HealthReport> {
  const fetchFn = deps.fetchFn ?? fetch

  const [database, storage, github, pages] = await Promise.all([
    checkDatabase(deps.db),
    checkStorage(deps.db),
    checkGitHub(fetchFn),
    checkPages(deps.origin, fetchFn),
  ])

  // down = no se puede operar (BD o páginas); degraded = módulos secundarios
  // (Tareas/imágenes) afectados pero el negocio sigue. skip no penaliza.
  let status: HealthReport['status'] = 'ok'
  if (storage.status === 'fail' || github.status === 'fail') status = 'degraded'
  if (database.status === 'fail' || pages.status === 'fail') status = 'down'

  return {
    status,
    app: 'dymmsa-web',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    timestamp: new Date().toISOString(),
    checks: { database, storage, github, pages },
  }
}
