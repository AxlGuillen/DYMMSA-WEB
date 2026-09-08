/** POST /quotes/lookup: catalogDescriptions is keyed by catalogKey(BRAND|CODE)
 *  over found products + Excel codes, so the quoter resolves per item brand. */

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
      // mc9 comes from the Excel (row with no etm_products record yet)
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

    // the catalog query used the normalized union (MC1 from found + MC9 from the Excel)
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
        // no stub for urrea_catalog → default { data: null } (empty catalog)
      },
    })
    const res = await lookup.POST(makeRequest({ etmCodes: ['ETM-1'] }))
    const body = await res.json()
    expect(body.catalogDescriptions).toEqual({})
  })
})
