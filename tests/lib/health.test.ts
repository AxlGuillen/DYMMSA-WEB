/**
 * Health checks (GET /api/health). Los checks de módulos ejecutan las queries
 * reales (funciones compartidas de los tools MCP) — se prueban con el mock de
 * Supabase; GitHub con fetch stub. Sin red ni BD real.
 */

import { describe, test, expect, beforeEach, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMockSupabase, type MockConfig } from '../helpers/supabase-mock'
import { checkQuotations, checkStorage, checkGitHub, runHealthChecks } from '@/lib/health'

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

const githubOk: Fetcher = (async () => ({ ok: true, status: 200 })) as unknown as Fetcher
const githubDown: Fetcher = (async () => ({ ok: false, status: 401 })) as unknown as Fetcher

beforeEach(() => {
  delete process.env.GITHUB_TOKEN
  delete process.env.GITHUB_REPO
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

describe('runHealthChecks (agregación)', () => {
  test('todo bien → ok (github skip no penaliza)', async () => {
    const report = await runHealthChecks({ db: db(ALL_OK), fetchFn: githubOk })
    expect(report.status).toBe('ok')
    expect(report.checks.github.status).toBe('skip')
    expect(report.app).toBe('dymmsa-web')
    expect(Object.keys(report.checks)).toEqual(['quotations', 'orders', 'inventory', 'storage', 'github'])
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
