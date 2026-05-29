/**
 * SMOKE TEST (Fase 0) — valida que el approach de testing de backend funciona:
 *   1. vi.mock() intercepta @/lib/supabase/server
 *   2. el alias @/ resuelve los handlers reales
 *   3. NextResponse / NextRequest funcionan bajo Vitest
 *   4. el mock de Supabase inyecta auth y resuelve queries
 *
 * Si esto pasa, el resto de las fases (auth-guards, quotations, orders, inventory)
 * se construyen sobre la misma base.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, type MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH, quotationItem } from '../helpers/factories'
import { makeRequest } from '../helpers/request'
import { POST } from '@/app/api/quotations/save/route'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

// El cliente activo se intercambia por test; el mock lee la variable viva.
let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

describe('smoke: infraestructura de testing de backend', () => {
  test('handler real devuelve 401 cuando no hay usuario autenticado', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await POST(
      makeRequest({ name: 'Test', customer_name: 'Cliente', items: [] }),
    )
    expect(res.status).toBe(401)
  })

  test('pasa el guard de auth con usuario y llega a la validación (400 sin productos)', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    // items vacío → no hay producto → 400. Demuestra que superó requireAuth().
    const res = await POST(
      makeRequest({ name: 'Test', customer_name: 'Cliente', items: [] }),
    )
    expect(res.status).toBe(400)
  })

  test('crea cotización y registra inserts cuando todo es válido', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
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
        items: [quotationItem({ _id: 'i1' })],
      }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation_id).toBe('quote-1')
    expect(activeClient.didCall('quotations', 'insert')).toBe(true)
    expect(activeClient.didCall('quotation_items', 'insert')).toBe(true)
  })
})
