/**
 * Health checks del endpoint público /api/health: ok | degraded | down.
 * Endpoint público → respuestas gruesas (ok/fail/skip, sin detalles internos);
 * los checks reusan las queries reales de la app y se aíslan entre sí.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { getGitHubConfig } from '@/lib/github'
import { isOdooConfigured, odooEnv } from '@/lib/odoo/env'
import { appUrl } from '@/lib/mcp/env'
import { MCP_PATH, PROTECTED_RESOURCE_PATH, mcpResourceUrl, supabaseAuthIssuer } from '@/lib/mcp/routes'
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
    odoo: HealthCheck
    oauth_server: HealthCheck
    protected_resource: HealthCheck
    mcp_unauthenticated: HealthCheck
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

/** Corre un check con latencia y cap de timeout: colgado = fail, no espera a la plataforma. */
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

/** Módulos de negocio: la misma query que usa la app — prueba schema y relaciones, no un ping. */
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

/** Odoo (ADR-025): search_count vacío = llamada autenticada más barata; sin env → skip. */
export async function checkOdoo(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  if (!isOdooConfigured()) return { status: 'skip', detail: 'no configurado' }
  return timed('odoo', async () => {
    // odooEnv DENTRO de timed: si algún día su validación diverge del guard de
    // arriba, un throw aquí se reporta como fail — no tumba el endpoint entero.
    const { url, apiKey, db } = odooEnv()
    const res = await fetchFn(`${url}/json/2/account.move/search_count`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `bearer ${apiKey}`,
        ...(db ? { 'X-Odoo-Database': db } : {}),
      },
      body: JSON.stringify({ domain: [['id', '=', 0]] }),
      cache: 'no-store',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`Odoo JSON-2 → ${res.status} (¿API key vencida o revocada?)`)
  })
}

// ─── Checks del MCP remoto (OAuth, ADR-023) ────────────────────────────

/**
 * El servidor OAuth de Supabase está encendido (es un toggle beta del
 * dashboard: si alguien lo apaga, el conector muere sin que cambie el repo).
 */
export async function checkOauthServer(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  return timed('oauth_server', async () => {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/.well-known/oauth-authorization-server/auth/v1`
    const res = await fetchFn(url, { cache: 'no-store', signal: AbortSignal.timeout(CHECK_TIMEOUT_MS) })
    if (!res.ok) throw new Error(`discovery ${res.status}: el servidor OAuth de Supabase está apagado`)
    const body = (await res.json()) as { issuer?: string }
    const expected = supabaseAuthIssuer(process.env.NEXT_PUBLIC_SUPABASE_URL!)
    if (body.issuer !== expected) throw new Error(`issuer inesperado: ${body.issuer}`)
  })
}

/** El metadata RFC 9728 propio responde y anuncia la URI canónica del recurso. */
export async function checkProtectedResource(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  return timed('protected_resource', async () => {
    const res = await fetchFn(`${appUrl()}${PROTECTED_RESOURCE_PATH}`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (!res.ok) throw new Error(`metadata ${res.status}`)
    const body = (await res.json()) as { resource?: string }
    const expected = mcpResourceUrl(appUrl())
    if (body.resource !== expected) throw new Error(`resource inesperado: ${body.resource}`)
  })
}

/** MCP sin token debe dar 401 CON resource_metadata: atrapa fail-open y 401 mudo. */
export async function checkMcpUnauthenticated(fetchFn: Fetcher = fetch): Promise<HealthCheck> {
  const start = Date.now()
  try {
    const res = await fetchFn(`${appUrl()}${MCP_PATH}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Streamable HTTP exige aceptar ambos content types.
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      cache: 'no-store',
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    })
    if (res.status !== 401) {
      console.error(`Health check "mcp_unauthenticated" failed: esperaba 401, dio ${res.status}`)
      return { status: 'fail' }
    }
    const header = res.headers.get('www-authenticate') ?? ''
    if (!header.includes('resource_metadata')) {
      console.error('Health check "mcp_unauthenticated" failed: el 401 no trae resource_metadata')
      return { status: 'fail' }
    }
    return { status: 'ok', latency_ms: Date.now() - start }
  } catch (e) {
    console.error('Health check "mcp_unauthenticated" failed:', e)
    return { status: 'fail' }
  }
}

// ─── Agregación ────────────────────────────────────────────────────────

export async function runHealthChecks(deps: {
  db: SupabaseClient
  fetchFn?: Fetcher
}): Promise<HealthReport> {
  const fetchFn = deps.fetchFn ?? fetch
  const [quotations, orders, inventory, storage, github, odoo, oauthServer, protectedResource, mcpUnauthenticated] =
    await Promise.all([
      checkQuotations(deps.db),
      checkOrders(deps.db),
      checkInventory(deps.db),
      checkStorage(deps.db),
      checkGitHub(fetchFn),
      checkOdoo(fetchFn),
      checkOauthServer(fetchFn),
      checkProtectedResource(fetchFn),
      checkMcpUnauthenticated(fetchFn),
    ])

  // down = algún módulo de negocio no puede operar; degraded = módulos
  // secundarios (Tareas/imágenes/conector MCP) afectados pero el negocio sigue.
  // skip no penaliza.
  let status: HealthReport['status'] = 'ok'
  const secondary = [storage, github, odoo, oauthServer, protectedResource, mcpUnauthenticated]
  if (secondary.some((c) => c.status === 'fail')) status = 'degraded'
  if (quotations.status === 'fail' || orders.status === 'fail' || inventory.status === 'fail') {
    status = 'down'
  }

  return {
    status,
    app: 'dymmsa-web',
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
    timestamp: new Date().toISOString(),
    checks: {
      quotations,
      orders,
      inventory,
      storage,
      github,
      odoo,
      oauth_server: oauthServer,
      protected_resource: protectedResource,
      mcp_unauthenticated: mcpUnauthenticated,
    },
  }
}
