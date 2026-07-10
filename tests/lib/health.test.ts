/**
 * Health checks (GET /api/health). Las dependencias (db, fetch) se inyectan,
 * así que los checks se prueban con stubs — sin red ni BD real.
 */

import { describe, test, expect, beforeEach } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createMockSupabase } from '../helpers/supabase-mock'
import {
  checkDatabase,
  checkStorage,
  checkGitHub,
  checkPages,
  runHealthChecks,
} from '@/lib/health'

type Fetcher = typeof fetch

/** db stub con storage configurable (el mock del proyecto no modela storage). */
function dbWithStorage(listResult: { data?: unknown; error?: unknown }): SupabaseClient {
  return {
    storage: { from: () => ({ list: async () => listResult }) },
  } as unknown as SupabaseClient
}

/** fetch stub que responde por URL (status por defecto 200). */
function fetchStub(routes: Record<string, number>): Fetcher {
  return (async (input: RequestInfo | URL) => {
    const url = String(input)
    const match = Object.entries(routes).find(([k]) => url.includes(k))
    const status = match ? match[1] : 200
    return { ok: status >= 200 && status < 300, status } as Response
  }) as Fetcher
}

beforeEach(() => {
  delete process.env.GITHUB_TOKEN
  delete process.env.GITHUB_REPO
})

describe('checkDatabase', () => {
  test('ok con latencia cuando la query responde', async () => {
    const db = createMockSupabase({ responses: { quotations: { data: [{ id: 'x' }] } } })
    const result = await checkDatabase(db as unknown as SupabaseClient)
    expect(result.status).toBe('ok')
    expect(result.latency_ms).toBeTypeOf('number')
  })

  test('fail cuando la query trae error', async () => {
    const db = createMockSupabase({ responses: { quotations: { data: null, error: { message: 'x' } } } })
    const result = await checkDatabase(db as unknown as SupabaseClient)
    expect(result.status).toBe('fail')
    expect(result).not.toHaveProperty('detail') // público: sin mensajes internos
  })
})

describe('checkStorage', () => {
  test('ok cuando el bucket lista', async () => {
    expect((await checkStorage(dbWithStorage({ data: [], error: null }))).status).toBe('ok')
  })
  test('fail con error del bucket', async () => {
    expect((await checkStorage(dbWithStorage({ data: null, error: { message: 'x' } }))).status).toBe('fail')
  })
})

describe('checkGitHub', () => {
  test('skip sin configuración (no penaliza entornos sin el módulo)', async () => {
    expect((await checkGitHub()).status).toBe('skip')
  })

  test('ok / fail según el token contra /rate_limit', async () => {
    process.env.GITHUB_TOKEN = 't'
    process.env.GITHUB_REPO = 'o/r'
    expect((await checkGitHub(fetchStub({ 'rate_limit': 200 }))).status).toBe('ok')
    expect((await checkGitHub(fetchStub({ 'rate_limit': 401 }))).status).toBe('fail')
  })
})

describe('checkPages', () => {
  test('ok cuando /login=200 y / y /dashboard redirigen', async () => {
    const fetchFn = fetchStub({ '/login': 200, '/dashboard': 307, 'http://x/': 307 })
    const result = await checkPages('http://x', fetchFn)
    expect(result.status).toBe('ok')
    expect(result.pages).toEqual({ '/login': 'ok', '/': 'ok', '/dashboard': 'ok' })
  })

  test('un /dashboard que responde 200 sin sesión es FALLA (guard de auth roto)', async () => {
    const fetchFn = fetchStub({ '/login': 200, '/dashboard': 200, 'http://x/': 307 })
    const result = await checkPages('http://x', fetchFn)
    expect(result.status).toBe('fail')
    expect(result.pages['/dashboard']).toBe('fail')
  })
})

describe('runHealthChecks (agregación)', () => {
  const okDb = () => {
    const mock = createMockSupabase({ responses: { quotations: { data: [{ id: 'x' }] } } }) as unknown as {
      storage: unknown
    }
    mock.storage = { from: () => ({ list: async () => ({ data: [], error: null }) }) }
    return mock as unknown as SupabaseClient
  }
  const pagesOk = fetchStub({ '/login': 200, '/dashboard': 307, 'http://x/': 307 })

  test('todo bien → ok (github skip no penaliza)', async () => {
    const report = await runHealthChecks({ db: okDb(), origin: 'http://x', fetchFn: pagesOk })
    expect(report.status).toBe('ok')
    expect(report.checks.github.status).toBe('skip')
    expect(report.app).toBe('dymmsa-web')
  })

  test('storage caído → degraded (el negocio sigue operando)', async () => {
    const db = createMockSupabase({ responses: { quotations: { data: [{ id: 'x' }] } } }) as unknown as {
      storage: unknown
    }
    db.storage = { from: () => ({ list: async () => ({ data: null, error: { message: 'x' } }) }) }
    const report = await runHealthChecks({ db: db as unknown as SupabaseClient, origin: 'http://x', fetchFn: pagesOk })
    expect(report.status).toBe('degraded')
  })

  test('BD caída → down (aunque lo demás pase)', async () => {
    const db = createMockSupabase({ responses: { quotations: { data: null, error: { message: 'x' } } } }) as unknown as {
      storage: unknown
    }
    db.storage = { from: () => ({ list: async () => ({ data: [], error: null }) }) }
    const report = await runHealthChecks({ db: db as unknown as SupabaseClient, origin: 'http://x', fetchFn: pagesOk })
    expect(report.status).toBe('down')
  })

  test('página clave rota → down', async () => {
    const report = await runHealthChecks({
      db: okDb(),
      origin: 'http://x',
      fetchFn: fetchStub({ '/login': 500, '/dashboard': 307, 'http://x/': 307 }),
    })
    expect(report.status).toBe('down')
    expect(report.checks.pages.pages['/login']).toBe('fail')
  })
})
