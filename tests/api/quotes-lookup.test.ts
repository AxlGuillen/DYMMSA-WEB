/**
 * POST /quotes/lookup — búsqueda masiva de ETMs + descripciones de catálogo.
 *   - found/notFound por etm
 *   - catalogDescriptions: mapa catalogKey(MARCA|CODIGO)→descripción para la
 *     unión de model_codes (productos encontrados + códigos del Excel),
 *     normalizados; se omiten filas sin descripción. Incluye todas las marcas
 *     de esos códigos → el cotizador resuelve con la marca de cada ítem.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH } from '../helpers/factories'
import { makeRequest } from '../helpers/request'
import * as lookup from '@/app/api/quotes/lookup/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('POST /quotes/lookup', () => {
  test('400 si etmCodes no es arreglo o está vacío', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    expect((await lookup.POST(makeRequest({ etmCodes: 'x' }))).status).toBe(400)
    expect((await lookup.POST(makeRequest({ etmCodes: [] }))).status).toBe(400)
  })

  test('found/notFound + catalogDescriptions con union de model_codes', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': {
          data: [{ etm: 'ETM-1', model_code: 'MC1', description: 'P1' }],
          error: null,
        },
        'urrea_catalog.select': {
          data: [
            { code: 'MC1', brand: 'URREA', description: 'Oficial 1' },
            { code: 'MC9', brand: 'FOY', description: 'Oficial 9' },
          ],
          error: null,
        },
      },
    })
    const res = await lookup.POST(makeRequest({
      etmCodes: ['ETM-1', 'ETM-2'],
      // mc9 viene del Excel (fila aún sin registro en etm_products)
      modelCodes: [' mc9 '],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.found).toHaveLength(1)
    expect(body.notFound).toEqual(['ETM-2'])
    expect(body.catalogDescriptions).toEqual({
      'URREA|MC1': 'Oficial 1',
      'FOY|MC9': 'Oficial 9',
    })

    // la query al catálogo usó la union normalizada (MC1 del found + MC9 del Excel)
    const call = activeClient.callsTo('urrea_catalog', 'select')[0]
    const inFilter = call.filters.find((f) => f.method === 'in')
    expect(inFilter?.args[1]).toEqual(['MC1', 'MC9'])
  })

  test('sin catálogo cargado: catalogDescriptions vacío (no rompe)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'etm_products.select': {
          data: [{ etm: 'ETM-1', model_code: 'MC1', description: 'P1' }],
          error: null,
        },
        // sin respuesta para urrea_catalog → default { data: null } (catálogo vacío)
      },
    })
    const res = await lookup.POST(makeRequest({ etmCodes: ['ETM-1'] }))
    const body = await res.json()
    expect(body.catalogDescriptions).toEqual({})
  })
})
