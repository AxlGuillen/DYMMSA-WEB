/**
 * Cliente JSON-2 de Odoo (issue #65, ADR-025): la cola serializada (1 request
 * en vuelo + espaciado — el rate limit de Odoo Online no admite paralelas),
 * el backoff ante 429 y el mapeo de errores. Transporte y reloj inyectados:
 * sin red y sin esperas reales.
 */

import { describe, test, expect } from 'vitest'
import { createOdooCaller, OdooError } from '@/lib/odoo/client'

type FakeResponse = {
  ok: boolean
  status: number
  headers: { get: (h: string) => string | null }
  json: () => Promise<unknown>
  text: () => Promise<string>
}

function response(status: number, body: unknown = [], headers: Record<string, string> = {}): FakeResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (h) => headers[h.toLowerCase()] ?? null },
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

const ENV = { url: 'https://odoo.test', apiKey: 'k', db: null }

function caller(opts: {
  responses?: FakeResponse[]
  onFetch?: (url: string, init: RequestInit) => void
  spacingMs?: number
}) {
  const sleeps: number[] = []
  let inFlight = 0
  let maxInFlight = 0
  const queue = [...(opts.responses ?? [])]
  const call = createOdooCaller({
    spacingMs: opts.spacingMs ?? 0,
    getEnv: () => ENV,
    sleepFn: async (ms) => {
      sleeps.push(ms)
    },
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      inFlight++
      maxInFlight = Math.max(maxInFlight, inFlight)
      opts.onFetch?.(String(url), init!)
      // Un tick asíncrono real para que dos llamadas PUDIERAN traslaparse si
      // la cola no serializara.
      await Promise.resolve()
      inFlight--
      return (queue.shift() ?? response(200)) as unknown as Response
    }) as typeof fetch,
  })
  return { call, sleeps, maxInFlight: () => maxInFlight }
}

describe('createOdooCaller', () => {
  test('arma la URL JSON-2 y manda la key como bearer', async () => {
    let seenUrl = ''
    let seenAuth = ''
    const { call } = caller({
      responses: [response(200, [{ id: 1 }])],
      onFetch: (url, init) => {
        seenUrl = url
        seenAuth = (init.headers as Record<string, string>).Authorization
      },
    })
    const result = await call('account.move', 'search_read', { limit: 1 })
    expect(seenUrl).toBe('https://odoo.test/json/2/account.move/search_read')
    expect(seenAuth).toBe('bearer k')
    expect(result).toEqual([{ id: 1 }])
  })

  test('cola serializada: NUNCA hay dos requests en vuelo aunque disparen en paralelo', async () => {
    const c = caller({ responses: [response(200), response(200), response(200)] })
    await Promise.all([
      c.call('account.move', 'search_count', {}),
      c.call('account.move', 'search_count', {}),
      c.call('account.payment', 'search_count', {}),
    ])
    expect(c.maxInFlight()).toBe(1)
  })

  test('espaciado mínimo entre llamadas consecutivas', async () => {
    const c = caller({ responses: [response(200), response(200)], spacingMs: 1100 })
    await c.call('account.move', 'search_count', {})
    await c.call('account.move', 'search_count', {})
    // La segunda llamada esperó (hasta) el espaciado configurado.
    expect(c.sleeps.length).toBeGreaterThan(0)
    expect(Math.max(...c.sleeps)).toBeLessThanOrEqual(1100)
  })

  test('429: espera Retry-After y reintenta UNA vez', async () => {
    const c = caller({
      responses: [response(429, 'slow down', { 'retry-after': '3' }), response(200, [{ id: 9 }])],
    })
    const result = await c.call('account.move', 'search_read', {})
    expect(result).toEqual([{ id: 9 }])
    expect(c.sleeps).toContain(3000)
  })

  test('429 persistente: falla con OdooError tras el único reintento', async () => {
    const c = caller({ responses: [response(429), response(429)] })
    await expect(c.call('account.move', 'search_read', {})).rejects.toThrow(OdooError)
  })

  test('un error NO rompe la cola: la siguiente llamada sale normal', async () => {
    const c = caller({ responses: [response(500, 'boom'), response(200, [{ id: 2 }])] })
    await expect(c.call('account.move', 'search_read', {})).rejects.toThrow(/500/)
    await expect(c.call('account.move', 'search_read', {})).resolves.toEqual([{ id: 2 }])
  })

  test('status no-ok → OdooError con status y modelo.método en el mensaje', async () => {
    const c = caller({ responses: [response(403, 'denied')] })
    const error = await c.call('account.move', 'search_read', {}).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error.status).toBe(403)
    expect(error.message).toContain('account.move.search_read')
  })

  test('sin ODOO_URL/ODOO_API_KEY el error es accionable, no un crash', async () => {
    const call = createOdooCaller({
      spacingMs: 0,
      getEnv: () => {
        throw new OdooError('El bloque de Odoo no está configurado: faltan ODOO_URL y/o ODOO_API_KEY en el entorno del servidor.')
      },
    })
    await expect(call('account.move', 'search_read', {})).rejects.toThrow(/no está configurado/)
  })
})
