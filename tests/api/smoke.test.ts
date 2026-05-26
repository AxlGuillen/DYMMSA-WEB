/**
 * SMOKE TEST (Fase 0) — valida que el approach de testing de backend funciona:
 *   1. mock.module() intercepta @/lib/supabase/server
 *   2. el alias @/ resuelve los handlers reales
 *   3. NextResponse / NextRequest funcionan bajo `bun test`
 *   4. el mock de Supabase inyecta auth y resuelve queries
 *
 * Si esto pasa, el resto de las fases (auth-guards, quotations, orders, inventory)
 * se construyen sobre la misma base.
 */

import { describe, test, expect, mock } from 'bun:test'
import { createMockSupabase, type MockSupabaseClient } from '../helpers/supabase-mock'
import { makeRequest } from '../helpers/request'

// El cliente activo se intercambia por test; el factory lo cierra por referencia.
let activeClient: MockSupabaseClient

mock.module('@/lib/supabase/server', () => ({
  createClient: async () => activeClient,
}))

// Import dinámico DESPUÉS de registrar el mock del módulo.
const { POST } = await import('@/app/api/quotations/save/route')

describe('smoke: infraestructura de testing de backend', () => {
  test('handler real devuelve 401 cuando no hay usuario autenticado', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await POST(
      makeRequest({ name: 'Test', customer_name: 'Cliente', items: [] }),
    )
    expect(res.status).toBe(401)
  })

  test('pasa el guard de auth con usuario y llega a la validación (400 sin productos)', async () => {
    activeClient = createMockSupabase({ user: { id: 'user-1' } })
    // items vacío → no hay producto → 400. Demuestra que superó requireAuth().
    const res = await POST(
      makeRequest({ name: 'Test', customer_name: 'Cliente', items: [] }),
    )
    expect(res.status).toBe(400)
  })

  test('crea cotización y registra inserts cuando todo es válido', async () => {
    activeClient = createMockSupabase({
      user: { id: 'user-1' },
      responses: {
        'quotations.insert':      { data: { id: 'quote-1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
        // processAutoLearn consulta etm_products; lo dejamos sin match (no-op)
      },
    })
    const res = await POST(
      makeRequest({
        name: 'Cotización demo',
        customer_name: 'ACME',
        items: [
          {
            _id: 'i1', item_type: 'product', etm: 'ETM-1',
            description: 'Producto', description_es: 'Producto',
            model_code: 'MC1', brand: 'URREA', unit_price: 100, quantity: 2,
            delivery_time: 'immediate',
          },
        ],
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation_id).toBe('quote-1')
    expect(activeClient.didCall('quotations', 'insert')).toBe(true)
    expect(activeClient.didCall('quotation_items', 'insert')).toBe(true)
  })
})
