/**
 * Health checks (GET /api/health). Los checks de módulos ejecutan las queries
 * reales (funciones compartidas de los tools MCP) — se prueban con el mock de
 * Supabase; GitHub con fetch stub. Sin red ni BD real.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMockSupabase, type MockConfig } from '../helpers/supabase-mock'
import {
  checkQuotations,
  checkStorage,
  checkGitHub,
  checkOauthServer,
  checkProtectedResource,
  checkMcpUnauthenticated,
  runHealthChecks,
} from '@/lib/health'

type Fetcher = typeof fetch

/** Mock del proyecto + storage stub (el mock base no modela storage). */
function db(responses: MockConfig['responses'], storageError: unknown = null): SupabaseClient {
  const mock = createMockSupabase({ responses }) as unknown as { storage: unknown }
  mock.storage = {
    from: () => ({ list: async () => ({ data: storageError ? null : [], error: storageError }) }),
  }
  return mock as unknown as SupabaseClient
}

const ALL_OK: MockConfig['responses'] = {
  quotations: { data: [], count: 0 },
  orders: { data: [], count: 0 },
  store_inventory: { data: [], count: 0 },
}

// runHealthChecks usa appUrl() (localhost:3000 en tests) y la URL de Supabase.
const SUPA = 'https://test.supabase.co'
const ISSUER = `${SUPA}/auth/v1`

type StubResponse = {
  ok?: boolean
  status?: number
  json?: unknown
  headers?: Record<string, string>
}

/** Fetch stub por-URL: cada check pega a un endpoint distinto. */
function fetchRouter(routes: Record<string, StubResponse>): Fetcher {
  return (async (input: string | URL | Request) => {
    const url = String(input)
    const match = Object.entries(routes).find(([key]) => url.includes(key))
    const r = match?.[1] ?? { ok: true, status: 200, json: {} }
    return {
      ok: r.ok ?? true,
      status: r.status ?? 200,
      json: async () => r.json ?? {},
      headers: { get: (name: string) => r.headers?.[name.toLowerCase()] ?? null },
    }
  }) as unknown as Fetcher
}

/** Todo el mundo OAuth sano + GitHub 200 (para los tests de agregación). */
function healthyFetch(overrides: Record<string, StubResponse> = {}): Fetcher {
  return fetchRouter({
    'oauth-authorization-server': { json: { issuer: ISSUER } },
    'oauth-protected-resource': { json: { resource: 'http://localhost:3000/api/mcp' } },
    '/api/mcp': { status: 401, headers: { 'www-authenticate': 'Bearer resource_metadata="..."' } },
    'api.github.com': { ok: true, status: 200 },
    ...overrides,
  })
}

const githubOk: Fetcher = healthyFetch()
const githubDown: Fetcher = healthyFetch({ 'api.github.com': { ok: false, status: 401 } })

beforeEach(() => {
  delete process.env.GITHUB_TOKEN
  delete process.env.GITHUB_REPO
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPA
})

describe('checks de módulos (queries reales con admin client)', () => {
  test('ok con latencia cuando la query del módulo responde', async () => {
    const result = await checkQuotations(db(ALL_OK))
    expect(result.status).toBe('ok')
    expect(result.latency_ms).toBeTypeOf('number')
  })

  test('fail sin detalle interno cuando la query truena (público = respuesta gruesa)', async () => {
    const result = await checkQuotations(db({ quotations: { data: null, error: { message: 'boom' } } }))
    expect(result.status).toBe('fail')
    expect(result).not.toHaveProperty('detail')
  })

  test('query colgada → fail por timeout (no espera al límite de la plataforma)', async () => {
    vi.useFakeTimers()
    try {
      // Query builder que encadena pero jamás resuelve (thenable sin callback):
      // el cap de 5s del check debe cortarla y reportar fail.
      type HungQuery = { [k in 'or' | 'eq' | 'order' | 'range']: () => HungQuery } & { then: () => void }
      const hungQuery: HungQuery = {
        or: () => hungQuery,
        eq: () => hungQuery,
        order: () => hungQuery,
        range: () => hungQuery,
        then: () => {},
      }
      const hung = { from: () => ({ select: () => hungQuery }) } as unknown as SupabaseClient
      const pending = checkQuotations(hung)
      await vi.advanceTimersByTimeAsync(5001)
      expect((await pending).status).toBe('fail')
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('checkStorage', () => {
  test('ok cuando el bucket lista; fail con error', async () => {
    expect((await checkStorage(db(ALL_OK))).status).toBe('ok')
    expect((await checkStorage(db(ALL_OK, { message: 'x' }))).status).toBe('fail')
  })
})

describe('checkGitHub', () => {
  test('skip sin configuración (no penaliza entornos sin el módulo)', async () => {
    expect((await checkGitHub()).status).toBe('skip')
  })

  test('ok / fail según el token contra /rate_limit', async () => {
    process.env.GITHUB_TOKEN = 't'
    process.env.GITHUB_REPO = 'o/r'
    expect((await checkGitHub(githubOk)).status).toBe('ok')
    expect((await checkGitHub(githubDown)).status).toBe('fail')
  })
})

describe('checks del MCP remoto (OAuth, ADR-023)', () => {
  test('oauth_server: ok con issuer correcto; fail si el discovery no responde o el issuer no cuadra', async () => {
    expect((await checkOauthServer(healthyFetch())).status).toBe('ok')
    expect(
      (await checkOauthServer(healthyFetch({ 'oauth-authorization-server': { ok: false, status: 404 } })))
        .status,
    ).toBe('fail')
    expect(
      (await checkOauthServer(healthyFetch({ 'oauth-authorization-server': { json: { issuer: 'https://otro' } } })))
        .status,
    ).toBe('fail')
  })

  test('protected_resource: ok con la URI canónica; fail si anuncia otro recurso', async () => {
    expect((await checkProtectedResource(healthyFetch())).status).toBe('ok')
    expect(
      (await checkProtectedResource(
        healthyFetch({ 'oauth-protected-resource': { json: { resource: 'https://otra-app/api/mcp' } } }),
      )).status,
    ).toBe('fail')
  })

  test('mcp_unauthenticated: 401 + resource_metadata = ok', async () => {
    expect((await checkMcpUnauthenticated(healthyFetch())).status).toBe('ok')
  })

  test('REGLA: un 200 sin token es fail-open y debe reportar fail', async () => {
    const failOpen = healthyFetch({ '/api/mcp': { status: 200, json: { jsonrpc: '2.0' } } })
    expect((await checkMcpUnauthenticated(failOpen)).status).toBe('fail')
  })

  test('un 401 mudo (sin resource_metadata) también es fail: los conectores no descubren OAuth', async () => {
    const mute = healthyFetch({ '/api/mcp': { status: 401, headers: {} } })
    expect((await checkMcpUnauthenticated(mute)).status).toBe('fail')
  })
})

describe('runHealthChecks (agregación)', () => {
  test('todo bien → ok (github skip no penaliza)', async () => {
    const report = await runHealthChecks({ db: db(ALL_OK), fetchFn: githubOk })
    expect(report.status).toBe('ok')
    expect(report.checks.github.status).toBe('skip')
    expect(report.app).toBe('dymmsa-web')
    expect(Object.keys(report.checks)).toEqual([
      'quotations', 'orders', 'inventory', 'storage', 'github',
      'oauth_server', 'protected_resource', 'mcp_unauthenticated',
    ])
  })

  test('conector MCP roto (p. ej. OAuth server apagado) → degraded, no down', async () => {
    const report = await runHealthChecks({
      db: db(ALL_OK),
      fetchFn: healthyFetch({ 'oauth-authorization-server': { ok: false, status: 404 } }),
    })
    expect(report.status).toBe('degraded')
    expect(report.checks.oauth_server.status).toBe('fail')
    expect(report.checks.quotations.status).toBe('ok')
  })

  test('storage caído → degraded (el negocio sigue operando)', async () => {
    const report = await runHealthChecks({ db: db(ALL_OK, { message: 'x' }), fetchFn: githubOk })
    expect(report.status).toBe('degraded')
  })

  test('github caído → degraded', async () => {
    process.env.GITHUB_TOKEN = 't'
    process.env.GITHUB_REPO = 'o/r'
    const report = await runHealthChecks({ db: db(ALL_OK), fetchFn: githubDown })
    expect(report.status).toBe('degraded')
    expect(report.checks.github.status).toBe('fail')
  })

  test('un módulo de negocio caído → down aunque lo demás pase', async () => {
    const report = await runHealthChecks({
      db: db({ ...ALL_OK, orders: { data: null, error: { message: 'x' } } }),
      fetchFn: githubOk,
    })
    expect(report.status).toBe('down')
    expect(report.checks.orders.status).toBe('fail')
    expect(report.checks.quotations.status).toBe('ok') // checks aislados
  })
})
