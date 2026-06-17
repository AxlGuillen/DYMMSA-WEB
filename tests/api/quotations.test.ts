/**
 * Fase 2 — Cotizaciones.
 *
 * Cubre las reglas de negocio críticas de los handlers de cotización:
 *   - save:        validación, status='draft', sort_order=index, is_approved=null,
 *                  separadores con campos null, total excluye separadores, rollback.
 *   - update:      guardas de estado, preservación de is_approved en aprobadas, rollback.
 *   - create-order: solo productos aprobados + separadores, deduce stock, rollback.
 */

import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH, quotationItem as product, separator } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as save from '@/app/api/quotations/save/route'
import * as update from '@/app/api/quotations/[id]/update/route'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as status from '@/app/api/quotations/[id]/status/route'
import * as autoLearnModule from '@/lib/auto-learn'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

// ─── quotations/save ───────────────────────────────────────────────────

describe('POST /quotations/save', () => {
  test('400 si falta el nombre', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await save.POST(makeRequest({ name: '', customer_name: 'ACME', items: [product()] }))
    expect(res.status).toBe(400)
  })

  test('400 si falta el cliente', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await save.POST(makeRequest({ name: 'Q', customer_name: '', items: [product()] }))
    expect(res.status).toBe(400)
  })

  test('400 si no hay ningún producto (solo separador)', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await save.POST(makeRequest({ name: 'Q', customer_name: 'ACME', items: [separator()] }))
    expect(res.status).toBe(400)
  })

  test('happy path: crea quotation draft y devuelve total/conteo', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ unit_price: 100, quantity: 2 }), product({ unit_price: 50, quantity: 4 })],
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.quotation_id).toBe('q1')
    expect(body.items_count).toBe(2)
    expect(body.total_amount).toBe(400) // 100*2 + 50*4

    // quotation insertada con status draft
    const qPayload = activeClient.callsTo('quotations', 'insert')[0].payload as Record<string, unknown>
    expect(qPayload.status).toBe('draft')
    expect(qPayload.created_by).toBe('user-1')
  })

  test('REGLA: items con sort_order=index, is_approved=null; separador con campos null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product(), separator(), product()],
    }))
    const items = activeClient.insertPayload('quotation_items')
    expect(items).toHaveLength(3)
    // sort_order = posición en el array
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2])
    // todos los nuevos arrancan is_approved=null
    expect(items.every((i) => i.is_approved === null)).toBe(true)
    // separador con campos de producto en null
    const sep = items[1]
    expect(sep.item_type).toBe('separator')
    expect(sep.etm).toBeNull()
    expect(sep.unit_price).toBeNull()
    expect(sep.section_label).toBe('Sección A')
  })

  test('REGLA: total excluye separadores', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ unit_price: 100, quantity: 2 }), separator({ unit_price: 999, quantity: 5 })],
    }))
    const body = await res.json()
    expect(body.total_amount).toBe(200) // separador ignorado
  })

  test('REGLA: rollback — si falla insert de items, borra la quotation', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: { message: 'fail' } },
      },
    })
    const res = await save.POST(makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('quotations', 'delete')).toBe(true)
  })

  test('REGLA: constraint quantity_check → 400 con offendingEtm y mensaje específico', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': {
          data: null,
          error: {
            code: '23514',
            message: 'new row violates check constraint "quotation_items_quantity_check"',
          },
        },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [
        product({ etm: 'OK-1', quantity: 5 }),
        product({ etm: 'BAD-1', quantity: 0 }), // ofensor
      ],
    }))
    expect(res.status).toBe(400) // violación de regla, no 500
    const body = await res.json()
    expect(body.offendingEtm).toBe('BAD-1')
    expect(body.message).toContain('BAD-1')
    expect(body.message).toMatch(/cantidad/i)
    expect(activeClient.didCall('quotations', 'delete')).toBe(true) // rollback igual
  })

  test('REGLA: constraint price_check → 400 con offendingEtm', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': {
          data: null,
          error: {
            code: '23514',
            message: 'new row violates check constraint "quotation_items_price_check"',
          },
        },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ etm: 'NEG-1', unit_price: -5, quantity: 1 })],
    }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.offendingEtm).toBe('NEG-1')
    expect(body.message).toMatch(/precio negativo/i)
  })

  test('REGLA: save sobrevive a fallo de auto-learn (warning, NO 500)', async () => {
    // El try/catch en torno a processAutoLearn protege el save: si auto-learn
    // tira excepción, la cotización YA está guardada → 200 + warning.
    const spy = vi.spyOn(autoLearnModule, 'processAutoLearn')
      .mockRejectedValueOnce(new Error('auto-learn boom'))
    try {
      activeClient = createMockSupabase({
        user: AUTH,
        responses: {
          'quotations.insert': { data: { id: 'q1' }, error: null },
          'quotation_items.insert': { data: null, error: null },
        },
      })
      const res = await save.POST(makeRequest({
        name: 'Q', customer_name: 'ACME', items: [product()],
      }))
      expect(res.status).toBe(200)
      const body = await res.json()
      expect(body.quotation_id).toBe('q1')
      expect(body.warning).toBe('auto_learn_failed')
      // No se ejecutó rollback: la cotización está bien guardada.
      expect(activeClient.didCall('quotations', 'delete')).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })
})

// ─── quotations/[id]/update ──────────────────────────────────────────────

describe('PATCH /quotations/[id]/update', () => {
  test('404 si la cotización no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: null, error: { message: 'nf' } } },
    })
    const res = await update.PATCH(
      makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }),
      makeParams({ id: 'q1' }),
    )
    expect(res.status).toBe(404)
  })

  test('400 si el estado no es editable (converted_to_order)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: { id: 'q1', status: 'converted_to_order' }, error: null } },
    })
    const res = await update.PATCH(
      makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }),
      makeParams({ id: 'q1' }),
    )
    expect(res.status).toBe(400)
  })

  test('sent_for_approval es editable (200) — el API lo permite aunque el UI canEdit no', async () => {
    // canEdit del UI = isDraft || isApproved, pero el route admite además sent_for_approval.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'sent_for_approval' }, error: null },
        'quotation_items.select': { data: [], error: null },
        'quotation_items.delete': { data: null, error: null },
        'quotation_items.insert': { data: null, error: null },
        'quotations.update': { data: null, error: null },
      },
    })
    const res = await update.PATCH(
      makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }),
      makeParams({ id: 'q1' }),
    )
    expect(res.status).toBe(200)
  })

  test('REGLA: en aprobada, preserva is_approved del item (true/false) y deja null a los nuevos', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'approved' }, error: null },
        'quotation_items.select': { data: [], error: null },
        'quotation_items.delete': { data: null, error: null },
        'quotation_items.insert': { data: null, error: null },
        'quotations.update': { data: null, error: null },
      },
    })
    await update.PATCH(
      makeRequest({
        name: 'Q', customer_name: 'ACME',
        items: [
          product({ is_approved: true }),
          product({ is_approved: false }),
          product({ is_approved: null }), // nuevo / pendiente
        ],
      }),
      makeParams({ id: 'q1' }),
    )
    const items = activeClient.insertPayload('quotation_items')
    expect(items.map((i) => i.is_approved)).toEqual([true, false, null])
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2])
  })

  test('REGLA: rollback — si falla insert, re-inserta los items originales', async () => {
    const existing = [{ id: 'db1', quotation_id: 'q1', item_type: 'product', is_approved: true }]
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'approved' }, error: null },
        'quotation_items.select': { data: existing, error: null },
        'quotation_items.delete': { data: null, error: null },
        'quotation_items.insert': { data: null, error: { message: 'fail' } },
      },
    })
    const res = await update.PATCH(
      makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }),
      makeParams({ id: 'q1' }),
    )
    expect(res.status).toBe(500)
    // dos inserts: el fallido + el de restauración
    expect(activeClient.callsTo('quotation_items', 'insert')).toHaveLength(2)
    const restored = activeClient.callsTo('quotation_items', 'insert')[1].payload
    expect(restored).toEqual(existing)
  })
})

// ─── quotations/[id]/create-order ────────────────────────────────────────

describe('POST /quotations/[id]/create-order', () => {
  test('404 si la cotización no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: null, error: { message: 'nf' } } },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(404)
  })

  test('400 si el estado no es approved', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: { id: 'q1', status: 'draft', quotation_items: [] }, error: null } },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(400)
  })

  test('400 si no hay productos aprobados', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: false, sort_order: 0, model_code: 'MC1', quantity: 1, unit_price: 10 },
            ],
          },
          error: null,
        },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(400)
  })

  test('REGLA: order_items incluye separadores + solo productos aprobados; deduce stock; marca convertida', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'sep', item_type: 'separator', section_label: 'A', sort_order: 0 },
              { id: 'p1', item_type: 'product', is_approved: true,  sort_order: 1, model_code: 'MC1', quantity: 3, unit_price: 100, etm: 'E1', brand: 'URREA' },
              { id: 'p2', item_type: 'product', is_approved: false, sort_order: 2, model_code: 'MC2', quantity: 5, unit_price: 50,  etm: 'E2', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 10 }, error: null }, // stock cubre los 3 de MC1
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': { data: null, error: null },
        'store_inventory.update': { data: null, error: null },
        'quotations.update': { data: null, error: null },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.order_id).toBe('o1')
    expect(body.items_count).toBe(1)       // 1 producto aprobado
    expect(body.total_amount).toBe(300)    // 100*3 (p2 rechazado excluido)

    const items = activeClient.insertPayload('order_items')
    expect(items).toHaveLength(2)          // separador + p1 aprobado
    expect(items.map((i) => i.item_type)).toEqual(['separator', 'product'])
    const p1 = items.find((i) => i.item_type === 'product')!
    expect(p1.quantity_approved).toBe(3)
    expect(p1.quantity_in_stock).toBe(3)   // stock 10 cubre los 3
    expect(p1.quantity_to_order).toBe(0)

    // dedujo inventario y marcó la cotización como convertida
    expect(activeClient.didCall('store_inventory', 'update')).toBe(true)
    const upd = activeClient.updatePayload('quotations')
    expect(upd.status).toBe('converted_to_order')
  })

  test('REGLA: rollback — si falla insert de order_items, borra la orden', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: true, sort_order: 0, model_code: '', quantity: 1, unit_price: 10, etm: 'E1', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': { data: null, error: { message: 'fail' } },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('orders', 'delete')).toBe(true)
  })

  test('REGLA: constraint quantity_approved_check → 400 con offendingEtm', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              // Aprobado con quantity 0 → violará quantity_approved_check al insertar order_items
              { id: 'p1', item_type: 'product', is_approved: true, sort_order: 0, model_code: 'MC1', quantity: 0, unit_price: 10, etm: 'BAD-1', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': {
          data: null,
          error: {
            code: '23514',
            message: 'violates check constraint "order_items_quantity_approved_check"',
          },
        },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(400) // violación de regla, no 500
    const body = await res.json()
    expect(body.offendingEtm).toBe('BAD-1')
    expect(body.message).toContain('BAD-1')
    expect(body.message).toMatch(/cantidad/i)
    expect(activeClient.didCall('orders', 'delete')).toBe(true) // rollback igual
  })
})

// ─── quotations/[id]/status (cambio manual de estado) ────────────────────

describe('PATCH /quotations/[id]/status', () => {
  test('401 sin usuario autenticado', async () => {
    activeClient = createMockSupabase({ user: null })
    const res = await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(401)
  })

  test('400 si el target es converted_to_order (no es destino manual)', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const res = await status.PATCH(
      makeRequest({ status: 'converted_to_order' }),
      makeParams({ id: 'q1' }),
    )
    expect(res.status).toBe(400)
  })

  test('404 si la cotización no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: null, error: { message: 'nf' } } },
    })
    const res = await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(404)
  })

  test('revierte sent_for_approval → draft (200) sin tocar los items', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'sent_for_approval' }, error: null },
        'quotations.update': { data: { id: 'q1', status: 'draft' }, error: null },
      },
    })
    const res = await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('quotations')).toMatchObject({ status: 'draft' })
    expect(activeClient.didCall('quotation_items', 'delete')).toBe(false)
    expect(activeClient.didCall('quotation_items', 'update')).toBe(false)
  })

  test('GUARDA: converted_to_order con orden vinculada (cualquier estado) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'converted_to_order' }, error: null },
        // La orden existe (incluso cancelada bloquea: hay que eliminarla).
        'orders.select': { data: [{ id: 'o1' }], error: null },
      },
    })
    const res = await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.message).toMatch(/elimina la orden vinculada/i)
    expect(activeClient.didCall('quotations', 'update')).toBe(false)
  })

  test('converted_to_order sin orden vinculada (eliminada) → 200', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'converted_to_order' }, error: null },
        'orders.select': { data: [], error: null },
        'quotations.update': { data: { id: 'q1', status: 'draft' }, error: null },
      },
    })
    const res = await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    expect(activeClient.updatePayload('quotations')).toMatchObject({ status: 'draft' })
  })
})
