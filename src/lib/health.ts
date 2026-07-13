/**
 * Health checks de la aplicación — lógica pura del endpoint público GET /api/health.
 *
 * Contrato (pensado para reutilizarse en todos los proyectos):
 *   - status global: ok | degraded | down  →  HTTP 200 | 200 | 503
 *   - `down` solo por fallas que impiden operar (módulos de negocio);
 *     `degraded` por dependencias secundarias (GitHub/Tareas, Storage).
 *   - Respuestas GRUESAS: el endpoint es público, así que nunca se exponen
 *     mensajes de error internos ni nombres de env vars — solo ok/fail/skip.
 *     El porqué de un fail va al server log.
 *
 * Los checks de módulos ejecutan las MISMAS queries que sirven a la app
 * (reutilizan las funciones de src/lib/mcp/tools) directo con el admin client
 * — no self-fetch a /api/* (esas rutas exigen sesión y responderían 401).
 * Que el endpoint responda ya prueba que el deploy vive.
 *
 * Cada check está aislado (una dependencia caída no tumba a las demás) y las
 * dependencias (db, fetch) se inyectan para testear con stubs.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getGitHubConfig } from '@/lib/github'
import { listQuotations } from '@/lib/mcp/tools/quotations'
import { listOrders } from '@/lib/mcp/tools/orders'
import { searchInventory } from '@/lib/mcp/tools/inventory'

export type CheckStatus = 'ok' | 'fail' | 'skip'

export interface HealthCheck {
  status: CheckStatus
  latency_ms?: number
  detail?: string
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down'
  app: string
  version: string | null
  timestamp: string
  checks: {
    quotations: HealthCheck
    orders: HealthCheck
    inventory: HealthCheck
    storage: HealthCheck
    github: HealthCheck
  }
}

type Fetcher = typeof fetch

const CHECK_TIMEOUT_MS = 5000

/** Promesa que rechaza al vencer el plazo — cap para checks cuya query no expone señal de aborto. */
function checkTimeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const id = setTimeout(() => reject(new Error(`timeout tras ${ms}ms`)), ms)
    // En Node el timer retendría el proceso; unref lo libera (en edge no existe).
    if (typeof id === 'object' && 'unref' in id) id.unref()
  })
}

/**
 * Ejecuta un check midiendo latencia; cualquier error → fail (detalle al log).
 * Todos los checks corren con cap de CHECK_TIMEOUT_MS: si la dependencia se
 * cuelga (BD lenta, Storage sin responder), el endpoint público reporta fail
 * en vez de esperar al límite de la plataforma.
 */
async function timed(name: string, fn: () => Promise<unknown>): Promise<HealthCheck> {
  const start = Date.now()
  try {
    await Promise.race([fn(), checkTimeout(CHECK_TIMEOUT_MS)])
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e) {
    console.error(`Health check "${name}" failed:`, e)
    return { status: 'fail' }
  }
}

// ─── Checks ────────────────────────────────────────────────────────────

/**
 * Módulos de negocio: corren la misma query que usa la app (vía las funciones
 * compartidas de los tools MCP) — prueban conexión, service role, schema y
 * relaciones embebidas, no solo que la BD conteste un ping.
 */
export const checkQuotations = (db: SupabaseClient) =>
  timed('quotations', () => listQuotations(db, { pageSize: 1 }))

export const checkOrders = (db: SupabaseClient) =>
  timed('orders', () => listOrders(db, { pageSize: 1 }))

export const checkInventory = (db: SupabaseClient) =>
  timed('inventory', () => searchInventory(db, { pageSize: 1 }))

/** El bucket de imágenes de Tareas responde (Storage vivo). */
export const checkStorage = (db: SupabaseClient) =>
  timed('storage', async () => {
    const { error } = await db.storage.from('task-images').list('', { limit: 1 })
    if (error) throw error
  })

/**
 * El token de GitHub (módulo Tareas) sigue válido. /rate_limit no consume
 * cuota. Sin configuración → skip (entorno local sin el módulo).
 */
export async function checkGitHub(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  const cfg = getGitHubConfig()
  if (!cfg) return { status: 'skip', detail: 'no configurado' }
  return timed('github', async () => {
    const res = await fetchFn('https://api.github.com/rate_limit', {
      headers: {
        Authorization: `Bearer ${cfg.token}`,
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`GitHub /rate_limit → ${res.status}`)
  })
}

// ─── Agregación ────────────────────────────────────────────────────────

export async function runHealthChecks(deps: {
  db: SupabaseClient
  fetchFn?: Fetcher
}): Promise<HealthReport> {
  const [quotations, orders, inventory, storage, github] = await Promise.all([
    checkQuotations(deps.db),
    checkOrders(deps.db),
    checkInventory(deps.db),
    checkStorage(deps.db),
    checkGitHub(deps.fetchFn ?? fetch),
  ])

  // down = algún módulo de negocio no puede operar; degraded = módulos
  // secundarios (Tareas/imágenes) afectados pero el negocio sigue. skip no penaliza.
  let status: HealthReport['status'] = 'ok'
  if (storage.status === 'fail' || github.status === 'fail') status = 'degraded'
  if (quotations.status === 'fail' || orders.status === 'fail' || inventory.status === 'fail') {
    status = 'down'
  }

  return {
    status,
    app: 'dymmsa-web',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    timestamp: new Date().toISOString(),
    checks: { quotations, orders, inventory, storage, github },
  }
}
