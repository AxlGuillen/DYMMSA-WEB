/** Odoo JSON-2 client (#65, ADR-025, #144): read-only caller, serialized queue, 429 backoff, error mapping.
 *  Transport and clock are injected — no network, no real waits. */

import { describe, test, expect, vi, afterEach } from 'vitest'
import {
  assertReadCall,
  callOdoo,
  createOdooCaller,
  createOdooQueue,
  OdooError,
  OdooUncertainWriteError,
  parseOdooError,
  READ_METHODS,
  type OdooQueue,
} from '@/lib/odoo/client'

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
  queue?: OdooQueue
  /** Shared across callers to observe overlap between them. */
  flight?: { now: number; max: number }
}) {
  const sleeps: number[] = []
  const flight = opts.flight ?? { now: 0, max: 0 }
  let fetches = 0
  const pending = [...(opts.responses ?? [])]
  const call = createOdooCaller({
    spacingMs: opts.spacingMs ?? 0,
    queue: opts.queue,
    getEnv: () => ENV,
    sleepFn: async (ms) => {
      sleeps.push(ms)
    },
    fetchFn: (async (url: string | URL | Request, init?: RequestInit) => {
      fetches++
      flight.now++
      flight.max = Math.max(flight.max, flight.now)
      opts.onFetch?.(String(url), init!)
      // A real async tick so two calls COULD overlap if the queue didn't serialize.
      await Promise.resolve()
      flight.now--
      return (pending.shift() ?? response(200)) as unknown as Response
    }) as typeof fetch,
  })
  return { call, sleeps, maxInFlight: () => flight.max, fetches: () => fetches }
}

/** Write and introspection methods: none may leave the shared reader. */
const NON_READ_METHODS = [
  'create',
  'write',
  'unlink',
  'action_post',
  'action_confirm',
  'create_invoices',
  'message_post',
  'read',
  'fields_get',
]

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
    // The second call waited (up to) the configured spacing.
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

describe('lector de solo lectura (#144)', () => {
  test('el lector rechaza cualquier método que no sea de lectura antes de llamar a Odoo', async () => {
    const c = caller({ spacingMs: 1100 })
    // Exact names only: case, padding or a path suffix don't sneak through.
    for (const method of [...NON_READ_METHODS, 'SEARCH_READ', ' search_read', 'search_read/../unlink']) {
      const error = await c.call('sale.order', method, {}).catch((e) => e)
      expect(error, method).toBeInstanceOf(OdooError)
      expect(error.message, method).toContain('no es de lectura')
    }
    expect(c.fetches()).toBe(0)
    // Rejected before the queue: they never took a slot, so the next read doesn't wait.
    await c.call('sale.order', 'search_count', {})
    expect(c.sleeps).toEqual([])
  })

  test('el modelo no puede colar otro método por la ruta de la URL', async () => {
    const c = caller({})
    for (const model of ['sale.order/create?', 'res.partner/../sale.order', 'Sale.Order', '']) {
      await expect(c.call(model, 'search_read', {}), model).rejects.toThrow(/no es un nombre de modelo/)
    }
    expect(c.fetches()).toBe(0)
  })

  test('los tres métodos de lectura salen tal cual', async () => {
    expect(READ_METHODS).toEqual(['search_read', 'read_group', 'search_count'])
    const urls: string[] = []
    const c = caller({ onFetch: (url) => urls.push(url) })
    for (const method of READ_METHODS) await c.call('l10n_mx_edi.document', method, {})
    expect(urls).toEqual(READ_METHODS.map((m) => `https://odoo.test/json/2/l10n_mx_edi.document/${m}`))
  })

  test('dos lectores sobre la misma cola nunca se traslapan', async () => {
    const queue = createOdooQueue({ spacingMs: 0 })
    const flight = { now: 0, max: 0 }
    const a = caller({ queue, flight })
    const b = caller({ queue, flight })
    await Promise.all([
      a.call('account.move', 'search_count', {}),
      b.call('sale.order', 'search_count', {}),
      a.call('res.partner', 'search_count', {}),
      b.call('account.payment', 'search_count', {}),
    ])
    expect(flight.max).toBe(1)
  })
})

describe('callOdoo (producción)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  test('callOdoo de producción es el lector restringido', async () => {
    // Fake transport and a reserved .test host: nothing can reach a real Odoo.
    const fetchSpy = vi.fn<typeof fetch>(async () => new Response('7', { status: 200 }))
    vi.stubGlobal('fetch', fetchSpy)
    vi.stubEnv('ODOO_URL', 'https://odoo.test')
    vi.stubEnv('ODOO_API_KEY', 'fake-key')
    vi.stubEnv('ODOO_DB', '')

    for (const method of NON_READ_METHODS) {
      await expect(callOdoo('sale.order', method, {}), method).rejects.toThrow(/no es de lectura/)
    }
    expect(fetchSpy).not.toHaveBeenCalled()

    // Same singleton still reads, through the stubbed fetch.
    await expect(callOdoo('res.partner', 'search_count', { domain: [] })).resolves.toBe(7)
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(String(fetchSpy.mock.calls[0][0])).toBe('https://odoo.test/json/2/res.partner/search_count')
  })
})

describe('errores JSON-2 (#144)', () => {
  function rawResponse(status: number, text: string): FakeResponse {
    return { ...response(status), text: async () => text }
  }

  const TRACEBACK =
    'Traceback (most recent call last):\n  File "/home/odoo/src/odoo/odoo/http.py", line 2271, in _serve_db\n    return service_model.retrying(self._serve_ir_http, self.env)\nValueError: Invalid field'

  test('el error JSON-2 solo deja pasar message, nunca el debug', async () => {
    const c = caller({
      responses: [
        response(500, {
          name: 'builtins.ValueError',
          message: "Invalid field 'team_id' on model 'res.partner'",
          arguments: ["Invalid field 'team_id' on model 'res.partner'"],
          context: { lang: 'es_MX', uid: 2 },
          debug: TRACEBACK,
        }),
      ],
    })
    const error = await c.call('res.partner', 'search_read', {}).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error.status).toBe(500)
    expect(error.message).toBe("Odoo rechazó res.partner.search_read: Invalid field 'team_id' on model 'res.partner'")
    expect(error.message).not.toMatch(/Traceback|http\.py|uid|builtins/)
  })

  test('un cuerpo que no es JSON-2 deja solo el status, nunca el cuerpo', async () => {
    const c = caller({ responses: [rawResponse(502, `<html><pre>${TRACEBACK}</pre></html>`)] })
    const error = await c.call('account.move', 'search_read', {}).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error.status).toBe(502)
    expect(error.message).toBe('Odoo respondió 502 en account.move.search_read.')
  })

  test('parseOdooError: solo un message no vacío cuenta, recortado a 300 caracteres', () => {
    expect(parseOdooError(JSON.stringify({ message: '  Registro no encontrado  ', debug: TRACEBACK }))).toBe(
      'Registro no encontrado',
    )
    const long = parseOdooError(JSON.stringify({ message: 'x'.repeat(1000) }))
    expect(long).toBe(`${'x'.repeat(300)}…`)
    for (const body of ['', 'boom', '"boom"', '[]', 'null', '{}', '{"message":"   "}', '{"message":42}', JSON.stringify({ debug: TRACEBACK })]) {
      expect(parseOdooError(body), body).toBeNull()
    }
  })

  test('OdooUncertainWriteError es un OdooError que pide repetir la misma llamada', () => {
    const error = new OdooUncertainWriteError('sale.order.create', 'quotation', 504)
    expect(error).toBeInstanceOf(OdooError)
    expect(error.name).toBe('OdooUncertainWriteError')
    expect(error.status).toBe(504)
    expect(error.operation).toBe('sale.order.create')
    expect(error.retry).toBe('quotation')
    expect(error.message).toContain('(sale.order.create)')
    expect(error.message).toContain('Repite exactamente la misma llamada')
    expect(error.message).toContain('No pidas otra vista previa')
  })

  test('la factura y el alta de productos no hablan de una clave ni de una vista previa que no tienen', () => {
    const invoice = new OdooUncertainWriteError('sale.advance.payment.inv.create_invoices', 'invoice')
    expect(invoice.message).toContain('Repite exactamente la misma llamada con el mismo folio')
    expect(invoice.message).toContain('no creo otro')
    const products = new OdooUncertainWriteError('product.product.create', 'products')
    expect(products.message).toContain('Repite el mismo clic')
    for (const error of [invoice, products]) {
      expect(error.message).toContain(`(${error.operation})`)
      expect(error.message).not.toMatch(/clave|vista previa/)
    }
  })
})

describe('fallas de red y límite de peticiones (#144)', () => {
  const KEY = 'odoo-secret-key-0123456789'

  function failing(cause: unknown) {
    return createOdooCaller({
      spacingMs: 0,
      getEnv: () => ({ url: 'https://odoo.test', apiKey: KEY, db: null }),
      fetchFn: (async () => {
        throw cause
      }) as typeof fetch,
    })
  }

  test('una falla de red nunca copia el mensaje del driver: puede traer la llave', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      // What undici really throws for a key with a newline (Headers.append echoes the value).
      const headerError = new TypeError(`Headers.append: "bearer ${KEY}\nX" is an invalid header value.`)
      const error = await failing(headerError)('res.partner', 'search_read', {}).catch((e) => e)
      expect(error).toBeInstanceOf(OdooError)
      expect(error.message).toBe('No se pudo contactar a Odoo (res.partner.search_read): error de red.')

      const dns = new TypeError(`fetch failed for bearer ${KEY}`, {
        cause: Object.assign(new Error(`getaddrinfo ENOTFOUND ${KEY}`), { code: 'ENOTFOUND' }),
      })
      await expect(failing(dns)('res.partner', 'search_read', {})).rejects.toThrow(/: error de red\.$/)

      // The server log keeps only fixed identifiers, never a message.
      expect(logged).toHaveBeenCalledTimes(2)
      expect(logged.mock.calls[0][1]).toEqual({ op: 'res.partner.search_read', name: 'TypeError', code: null })
      expect(logged.mock.calls[1][1]).toEqual({ op: 'res.partner.search_read', name: 'TypeError', code: 'ENOTFOUND' })
      expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY)
    } finally {
      logged.mockRestore()
    }
  })

  test('el timeout se reporta como tal, sin el texto del driver', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    try {
      const timeout = new DOMException(`The operation timed out (${KEY})`, 'TimeoutError')
      const error = await failing(timeout)('account.move', 'search_count', {}).catch((e) => e)
      expect(error.message).toBe('No se pudo contactar a Odoo (account.move.search_count): tiempo de espera agotado.')
      expect(JSON.stringify(logged.mock.calls)).not.toContain(KEY)
    } finally {
      logged.mockRestore()
    }
  })

  test('un Retry-After largo falla de inmediato en vez de detener la cola compartida', async () => {
    const c = caller({ responses: [response(429, 'slow down', { 'retry-after': '60' })] })
    const error = await c.call('account.move', 'search_read', {}).catch((e) => e)
    expect(error).toBeInstanceOf(OdooError)
    expect(error.status).toBe(429)
    expect(error.message).toContain('Odoo pidió esperar 60 s')
    // No sleep and no second request: the slot is released right away.
    expect(c.sleeps).toEqual([])
    expect(c.fetches()).toBe(1)
  })

  test('un Retry-After de hasta 5 s se respeta y se reintenta una vez', async () => {
    const c = caller({ responses: [response(429, 'slow down', { 'retry-after': '5' }), response(200, [{ id: 3 }])] })
    await expect(c.call('account.move', 'search_read', {})).resolves.toEqual([{ id: 3 }])
    expect(c.sleeps).toEqual([5000])
  })
})

describe('la lista de métodos de lectura no se puede ampliar (#144)', () => {
  test('READ_METHODS está congelado y el guardia no depende del arreglo exportado', async () => {
    expect(Object.isFrozen(READ_METHODS)).toBe(true)
    expect(() => (READ_METHODS as unknown as string[]).push('write')).toThrow(TypeError)
    expect(READ_METHODS).toEqual(['search_read', 'read_group', 'search_count'])
    expect(() => assertReadCall('sale.order', 'write')).toThrow(/no es de lectura/)
    expect(() => assertReadCall('sale.order', 'search_read')).not.toThrow()
  })
})
