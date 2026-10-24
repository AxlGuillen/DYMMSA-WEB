import { describe, test, expect, vi } from 'vitest'
import { createMockSupabase, MockSupabaseClient, filterValue, type ResponseValue } from '../helpers/supabase-mock'
import { injectSupabaseServer } from '../helpers/setup'
import { AUTH, quotationItem as product, separator } from '../helpers/factories'
import { makeRequest, makeParams } from '../helpers/request'
import * as save from '@/app/api/quotations/save/route'
import * as quotationRoute from '@/app/api/quotations/[id]/route'
import * as update from '@/app/api/quotations/[id]/update/route'
import * as createOrder from '@/app/api/quotations/[id]/create-order/route'
import * as status from '@/app/api/quotations/[id]/status/route'
import * as autoLearnModule from '@/lib/auto-learn'
import { quotationDb, lineId, Q_ID, type FakeLine } from '../helpers/quotation-rpc'

vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))

let activeClient: MockSupabaseClient
injectSupabaseServer(() => activeClient)

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
    expect(items.map((i) => i.sort_order)).toEqual([0, 1, 2])
    expect(items.every((i) => i.is_approved === null)).toBe(true)
    const sep = items[1]
    expect(sep.item_type).toBe('separator')
    expect(sep.etm).toBeNull()
    expect(sep.unit_price).toBeNull()
    expect(sep.section_label).toBe('Sección A')
    // no override → null (automatic color); products are always null
    expect(sep.separator_color).toBeNull()
    expect(items[0].separator_color).toBeNull()
  })

  test('persiste separator_color en separadores y lo nulea en productos (issue #73)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [
        separator({ separator_color: 'rose' }),
        // A product carrying a color (bad payload / bug) is NOT persisted.
        product({ separator_color: 'teal' }),
      ],
    }))
    const items = activeClient.insertPayload('quotation_items')
    expect(items[0].separator_color).toBe('rose')
    expect(items[1].separator_color).toBeNull()
  })

  test('REGLA: persiste is_sold (false/true/null) y separador con is_sold null', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ is_sold: false }), separator(), product({ is_sold: true }), product()],
    }))
    const items = activeClient.insertPayload('quotation_items')
    expect(items[0].is_sold).toBe(false)
    expect(items[1].is_sold).toBeNull() // separator
    expect(items[2].is_sold).toBe(true)
    expect(items[3].is_sold).toBeNull() // not defined
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
    expect(body.total_amount).toBe(200) // separator ignored
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

  test('REGLA (#157): la validación de líneas corre en el server — cantidad 0 → 400 con offendingEtm, sin insertar nada', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [
        product({ etm: 'OK-1', quantity: 5 }),
        product({ etm: 'BAD-1', quantity: 0 }), // offender
        product({ etm: 'BAD-2', quantity: null }),
      ],
    }))
    expect(res.status).toBe(400) // rule violation, not a 500
    const body = await res.json()
    expect(body.offendingEtm).toBe('BAD-1')
    expect(body.message).toContain('BAD-1')
    expect(body.message).toMatch(/cantidad/i)
    expect(body.message).toMatch(/1 problema más/)
    expect(activeClient.didCall('quotations', 'insert')).toBe(false)
  })

  test('REGLA (#157): precio negativo y cantidad con decimales también se rechazan en el server', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const negative = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ etm: 'NEG-1', unit_price: -5, quantity: 1 })],
    }))
    expect(negative.status).toBe(400)
    const body = await negative.json()
    expect(body.offendingEtm).toBe('NEG-1')
    expect(body.message).toMatch(/precio no puede ser negativo/i)

    const decimal = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ etm: 'DEC-1', quantity: 2.5 })],
    }))
    expect(decimal.status).toBe(400)
    expect((await decimal.json()).message).toMatch(/DEC-1.*entero/)
    expect(activeClient.didCall('quotations', 'insert')).toBe(false)
  })

  test('REGLA (#157): tiempo de entrega o tipo de línea fuera del enum → 400 antes de escribir', async () => {
    activeClient = createMockSupabase({ user: AUTH })
    const badDelivery = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME', items: [product({ etm: 'E-9', delivery_time: 'tomorrow' })],
    }))
    expect(badDelivery.status).toBe(400)
    expect(await badDelivery.json()).toMatchObject({ offendingEtm: 'E-9', message: expect.stringMatching(/tiempo de entrega/) })

    const badType = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME', items: [product(), { _id: 'x', item_type: 'note' }],
    }))
    expect(badType.status).toBe(400)
    expect(activeClient.didCall('quotations', 'insert')).toBe(false)
  })

  test('REGLA: "no lo vendemos" sin cantidad ni precio sigue exento de la validación', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product(), product({ etm: 'NO', is_sold: false, quantity: null, unit_price: null }), separator()],
    }))
    expect(res.status).toBe(200)
  })

  test('REGLA: una violación de CHECK en la BD → 400 descriptivo + rollback de la cotización', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': {
          data: null,
          error: {
            code: '23514',
            message: 'new row for relation "quotation_items" violates check constraint "quotation_items_delivery_time_check"',
          },
        },
      },
    })
    const res = await save.POST(makeRequest({ name: 'Q', customer_name: 'ACME', items: [product()] }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/tiempo de entrega/i)
    expect(activeClient.didCall('quotations', 'delete')).toBe(true)
  })

  test('REGLA: save sobrevive a fallo de auto-learn (warning, NO 500)', async () => {
    // The try/catch around processAutoLearn protects the save: if auto-learn
    // throws, the quotation is ALREADY stored → 200 + warning.
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
      // No rollback ran: the quotation is stored fine.
      expect(activeClient.didCall('quotations', 'delete')).toBe(false)
    } finally {
      spy.mockRestore()
    }
  })

  test('REGLA: dymmsa_description se resuelve con jerarquía de catálogo al guardar', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
        // The catalog has MC1; MC2 is missing.
        'urrea_catalog.select': { data: [{ code: 'MC1', description: 'Oficial URREA' }], error: null },
      },
    })
    await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [
        // catalog match: the official one wins over the curated
        product({ model_code: 'MC1', dymmsa_description: 'curada vieja' }),
        // no match: the curated one stays
        product({ etm: 'ETM-2', model_code: 'MC2', dymmsa_description: 'Martillo curado' }),
        // no match and no curated: null (empty cell)
        product({ etm: 'ETM-3', model_code: 'MC3', dymmsa_description: '' }),
        separator(),
      ],
    }))
    const rows = activeClient.insertPayload('quotation_items')
    expect(rows[0].dymmsa_description).toBe('Oficial URREA')
    expect(rows[1].dymmsa_description).toBe('Martillo curado')
    expect(rows[2].dymmsa_description).toBeNull()
    expect(rows[3].dymmsa_description).toBeNull() // separator

    // Auto-learn: the catalog-matched line never learns a curated text (ADR-013 rule 1).
    const learned = activeClient.callsTo('etm_products', 'insert')
      .map((c) => c.payload as Record<string, unknown>)
    expect(learned.map((r) => [r.etm, r.dymmsa_description])).toEqual([
      ['ETM-1', null],
      ['ETM-2', 'Martillo curado'],
      ['ETM-3', null],
    ])
  })

  test('REGLA: si urrea_catalog falla, auto-learn no aprende la Desc. DYMMSA de líneas con código', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
        'urrea_catalog.select': { data: null, error: { message: 'canceling statement due to statement timeout' } },
      },
    })
    const res = await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [
        product({ model_code: 'MC1', dymmsa_description: 'Oficial URREA' }),
        product({ etm: 'ETM-2', model_code: '', brand: '', dymmsa_description: 'Curada sin código' }),
      ],
    }))
    expect(res.status).toBe(200) // saving never depends on the catalog

    const learned = activeClient.callsTo('etm_products', 'insert')
      .map((c) => c.payload as Record<string, unknown>)
    expect(learned.map((r) => [r.etm, r.dymmsa_description])).toEqual([
      ['ETM-1', null],
      ['ETM-2', 'Curada sin código'],
    ])
  })

  test('REGLA: match de catálogo normaliza el model_code (espacios/minúsculas)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.insert': { data: { id: 'q1' }, error: null },
        'quotation_items.insert': { data: null, error: null },
        'urrea_catalog.select': { data: [{ code: 'MC1', description: 'Oficial' }], error: null },
      },
    })
    await save.POST(makeRequest({
      name: 'Q', customer_name: 'ACME',
      items: [product({ model_code: ' mc1 ', dymmsa_description: '' })],
    }))
    const rows = activeClient.insertPayload('quotation_items')
    expect(rows[0].dymmsa_description).toBe('Oficial')
  })
})

describe('PATCH /quotations/[id]/update', () => {
  const patchUpdate = (body: unknown, id = Q_ID) =>
    update.PATCH(makeRequest(body, { method: 'PATCH' }), makeParams({ id }))
  const body = (items: unknown[]) => ({ name: 'Q', customer_name: 'ACME', items })

  test('404 si la cotización no existe', async () => {
    const db = quotationDb()
    activeClient = db.client
    const res = await patchUpdate(body([product()]), '99999999-9999-4999-8999-999999999999')
    expect(res.status).toBe(404)
    expect(db.rpcParams('update_quotation')).toHaveLength(0)
  })

  test('400 si el estado no es editable (converted_to_order)', async () => {
    const db = quotationDb({ quotation: { status: 'converted_to_order' } })
    activeClient = db.client
    const res = await patchUpdate(body([product()]))
    expect(res.status).toBe(400)
    expect(db.rpcParams('update_quotation')).toHaveLength(0)
  })

  test('si la cotización deja de ser editable entre la lectura y el lock → 400 (P0001 de la función)', async () => {
    const db = quotationDb({ quotation: { status: 'draft' } })
    activeClient = db.client
    db.client.rpc = async () => ({ data: null, error: { code: 'P0001', message: 'quotation_not_editable' } })
    const res = await patchUpdate(body([product()]))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/solo se pueden editar/i)
  })

  test('sent_for_approval es editable (200) — el API lo permite aunque el UI canEdit no', async () => {
    activeClient = quotationDb({ quotation: { status: 'sent_for_approval' } }).client
    const res = await patchUpdate(body([product()]))
    expect(res.status).toBe(200)
  })

  test('REGLA (#157): conserva el id de las líneas que siguen, borra las quitadas e inserta las nuevas; sort_order = índice', async () => {
    const db = quotationDb({
      quotation: { status: 'approved' },
      lines: [
        { etm: 'A', is_approved: true },
        { etm: 'B', is_approved: true },
        { etm: 'C', is_approved: false },
      ],
    })
    activeClient = db.client
    const res = await patchUpdate(body([
      product({ _id: lineId(3), _dbId: lineId(3), etm: 'C', is_approved: false }),
      product({ etm: 'NUEVA', is_approved: null }),
      product({ _id: lineId(1), _dbId: lineId(1), etm: 'A', unit_price: 120, is_approved: true }),
    ]))
    expect(res.status).toBe(200)

    const lines = db.lines()
    expect(lines.map((l) => [l.etm, l.id === lineId(3) ? 'C' : l.id === lineId(1) ? 'A' : 'nuevo'])).toEqual([
      ['C', 'C'], ['NUEVA', 'nuevo'], ['A', 'A'],
    ])
    expect(lines.map((l) => l.sort_order)).toEqual([0, 1, 2])
    expect(lines.find((l) => l.etm === 'A')?.unit_price).toBe(120)
    expect(lines.some((l) => l.id === lineId(2))).toBe(false) // B was removed

    // Only real line ids travel; a new row goes with id null.
    const [params] = db.rpcParams('update_quotation')
    expect((params.p_items as Array<{ id: string | null }>).map((i) => i.id)).toEqual([lineId(3), null, lineId(1)])
    expect(params.p_header).toEqual({ name: 'Q', customer_name: 'ACME', total_amount: 640 })
  })

  test('un _dbId que no es línea de esta cotización (o repetido) entra como línea nueva', async () => {
    const db = quotationDb({ lines: [{ etm: 'A' }] })
    activeClient = db.client
    await patchUpdate(body([
      product({ _dbId: lineId(1), etm: 'A' }),
      product({ _dbId: lineId(1), etm: 'A-copia' }),
      product({ _dbId: '44444444-4444-4444-8444-444444444444', etm: 'AJENA' }),
      product({ _dbId: 'temp-1', etm: 'NO-UUID' }),
    ]))
    const ids = (db.rpcParams('update_quotation')[0].p_items as Array<{ id: string | null }>).map((i) => i.id)
    expect(ids).toEqual([lineId(1), null, null, null])
  })

  test('persiste separator_color del separador al reescribir los ítems (issue #73)', async () => {
    const db = quotationDb()
    activeClient = db.client
    const res = await patchUpdate(body([separator({ separator_color: 'amber' }), product({ separator_color: 'teal' })]))
    expect(res.status).toBe(200)
    const [sep, prod] = db.lines()
    expect(sep.separator_color).toBe('amber')
    expect(sep.is_approved).toBeNull()
    expect(prod.separator_color).toBeNull()   // product: always null
  })

  test('REGLA: en aprobada, preserva is_approved del item (true/false) y deja null a los nuevos', async () => {
    const db = quotationDb({ quotation: { status: 'approved' } })
    activeClient = db.client
    await patchUpdate(body([
      product({ is_approved: true }),
      product({ is_approved: false }),
      product({ is_approved: null }), // new / pending
    ]))
    expect(db.lines().map((l) => l.is_approved)).toEqual([true, false, null])
    expect(db.lines().map((l) => l.sort_order)).toEqual([0, 1, 2])
  })

  test('REGLA: preserva is_approved también en draft (reabierta) — no solo en aprobada', async () => {
    const db = quotationDb({ quotation: { status: 'draft' } })
    activeClient = db.client
    await patchUpdate(body([
      product({ is_approved: true }),  // approved before reopening → preserved
      product({ is_approved: null }),  // added after reopening → pending
    ]))
    expect(db.lines().map((l) => l.is_approved)).toEqual([true, null])
  })

  test('REGLA: si la UI no manda is_approved/is_sold, cae al valor guardado por _dbId', async () => {
    const db = quotationDb({ quotation: { status: 'approved' }, lines: [{ etm: 'A', is_approved: true, is_sold: true }] })
    activeClient = db.client
    const resent = product({ _dbId: lineId(1), etm: 'A' })
    await patchUpdate(body([resent]))
    const [params] = db.rpcParams('update_quotation')
    expect((params.p_items as Array<Record<string, unknown>>)[0]).toMatchObject({ is_approved: true, is_sold: true })
  })

  test('REGLA (#157): en revisión gana la decisión que guardó el cliente, no la del editor abierto antes', async () => {
    // The client saved progress (A approved) after DYMMSA opened the detail with A pending.
    const db = quotationDb({ quotation: { status: 'sent_for_approval' }, lines: [{ etm: 'A', is_approved: true }] })
    activeClient = db.client
    await patchUpdate(body([product({ _dbId: lineId(1), etm: 'A', unit_price: 90, is_approved: null })]))
    const [line] = db.lines()
    expect(line.id).toBe(lineId(1))
    expect(line.is_approved).toBe(true)
    expect(line.unit_price).toBe(90)
  })

  test('REGLA (#157): si la escritura falla, la cotización queda intacta (una sola transacción) → 500', async () => {
    const db = quotationDb({
      quotation: { status: 'approved', name: 'Original' },
      lines: [{ etm: 'A', is_approved: true, quantity: 2 }],
      updateError: { message: 'connection reset' },
    })
    activeClient = db.client
    const res = await patchUpdate(body([product({ etm: 'B' })]))
    expect(res.status).toBe(500)
    expect(db.lines()).toEqual([expect.objectContaining({ id: lineId(1), etm: 'A', is_approved: true, quantity: 2 })])
    expect(db.quotation.name).toBe('Original')
    // No auto-learn after a failed write.
    expect(db.client.didCall('etm_products', 'select')).toBe(false)
  })

  test('REGLA: una violación de regla en la BD → 400 descriptivo (explainPgError)', async () => {
    activeClient = quotationDb({
      updateError: { code: '23514', message: 'new row for relation "quotation_items" violates check constraint "quotation_items_delivery_time_check"' },
    }).client
    const res = await patchUpdate(body([product()]))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/tiempo de entrega/i)
  })

  test('si falla la lectura de las líneas guardadas → 500 sin escribir (antes se ignoraba)', async () => {
    const db = quotationDb({
      responses: { 'quotation_items.select': { data: null, error: { message: 'timeout' } } },
    })
    activeClient = db.client
    const res = await patchUpdate(body([product()]))
    expect(res.status).toBe(500)
    expect(db.rpcParams('update_quotation')).toHaveLength(0)
  })

  test('REGLA (#157): valida las líneas en el server — sin cantidad → 400 con offendingEtm y no escribe', async () => {
    const db = quotationDb()
    activeClient = db.client
    const res = await patchUpdate(body([product({ etm: 'OK-1' }), product({ etm: 'BAD-1', quantity: null })]))
    expect(res.status).toBe(400)
    const json = await res.json()
    expect(json.offendingEtm).toBe('BAD-1')
    expect(json.message).toMatch(/BAD-1.*cantidad/)
    expect(db.rpcParams('update_quotation')).toHaveLength(0)
  })

  test('REGLA: "no lo vendemos" y separadores quedan exentos de la validación', async () => {
    const db = quotationDb()
    activeClient = db.client
    const res = await patchUpdate(body([
      product({ etm: 'VENDE' }),
      product({ etm: 'NO-VENDE', is_sold: false, quantity: null, unit_price: null }),
      separator(),
    ]))
    expect(res.status).toBe(200)
  })

  test('el update sobrevive a un fallo de auto-learn (warning, NO 500)', async () => {
    const spy = vi.spyOn(autoLearnModule, 'processAutoLearn').mockRejectedValueOnce(new Error('auto-learn boom'))
    try {
      const db = quotationDb()
      activeClient = db.client
      const res = await patchUpdate(body([product()]))
      expect(res.status).toBe(200)
      expect((await res.json()).warning).toBe('auto_learn_failed')
      expect(db.lines()).toHaveLength(1)
    } finally {
      spy.mockRestore()
    }
  })

  test('REGLA: update re-resuelve dymmsa_description (catálogo gana; fallback a BD si la UI no la manda)', async () => {
    const db = quotationDb({
      lines: [
        { etm: 'ETM-1', dymmsa_description: 'curada guardada' },
        { etm: 'ETM-2', dymmsa_description: 'curada guardada 2' },
      ],
      responses: { 'urrea_catalog.select': { data: [{ code: 'MC1', description: 'Oficial URREA' }], error: null } },
    })
    activeClient = db.client
    const res = await patchUpdate(body([
      // catalog match: the official one overrides any curated
      product({ _dbId: lineId(1), model_code: 'MC1', dymmsa_description: 'curada UI' }),
      // no match and NO field (old client): falls back to the DB snapshot
      (() => { const it = product({ _dbId: lineId(2), etm: 'ETM-2', model_code: 'MC2' }); delete (it as Record<string, unknown>).dymmsa_description; return it })(),
    ]))
    expect(res.status).toBe(200)
    expect(db.lines().map((l) => l.dymmsa_description)).toEqual(['Oficial URREA', 'curada guardada 2'])
  })

  const etmRow = (etm: string, model_code: string, dymmsa_description: string | null) => ({
    etm, model_code, dymmsa_description, description: 'Producto', description_es: 'Producto',
    price: 100, brand: 'URREA', is_sold: null,
  })

  test('REGLA: el snapshot oficial que reenvía el detalle no se aprende como curada en etm_products', async () => {
    const db = quotationDb({
      quotation: { status: 'approved' },
      responses: {
        'urrea_catalog.select': { data: [{ code: 'MC1', brand: 'URREA', description: 'Oficial URREA' }], error: null },
        'etm_products.select': { data: [etmRow('ETM-1', 'MC1', null), etmRow('ETM-2', 'MC2', 'Vieja')], error: null },
      },
    })
    activeClient = db.client
    const res = await patchUpdate(body([
      // QuotationDetail sends the resolved snapshot back as if it were curated.
      product({ etm: 'ETM-1', model_code: 'MC1', unit_price: 120, dymmsa_description: 'Oficial URREA' }),
      product({ etm: 'ETM-2', model_code: 'MC2', dymmsa_description: 'Martillo curado' }),
    ]))
    expect(res.status).toBe(200)

    const updates = new Map(db.client.callsTo('etm_products', 'update').map((c) => [filterValue(c, 'etm'), c.payload]))
    expect(updates.get('ETM-1')).toEqual({ price: 120 })
    expect(updates.get('ETM-2')).toEqual({ dymmsa_description: 'Martillo curado' })
  })

  const learnClient = (lines: Array<Partial<FakeLine>>, responses: Record<string, ResponseValue>) => quotationDb({
    quotation: { status: 'approved' },
    lines,
    responses: {
      'etm_products.select': { data: [etmRow('ETM-1', 'MC1', null), etmRow('ETM-2', 'MC2', null)], error: null },
      ...responses,
    },
  })

  test('REGLA: si urrea_catalog falla al editar, la oficial reenviada no se copia a etm_products', async () => {
    const db = learnClient([], {
      'urrea_catalog.select': { data: null, error: { message: 'canceling statement due to statement timeout' } },
    })
    activeClient = db.client
    const res = await patchUpdate(body([
      product({ etm: 'ETM-1', model_code: 'MC1', unit_price: 120, dymmsa_description: 'Oficial URREA' }),
    ]))
    expect(res.status).toBe(200)
    expect(db.client.updatePayload('etm_products')).toEqual({ price: 120 })
  })

  test('REGLA: el snapshot reenviado sin cambios no se aprende aunque el catálogo ya no lo tenga; lo editado sí', async () => {
    const db = learnClient(
      [
        { etm: 'ETM-1', is_approved: true, dymmsa_description: 'Oficial URREA vieja' },
        { etm: 'ETM-2', is_approved: true, dymmsa_description: 'Curada vieja' },
      ],
      // A catalog reimport dropped MC1: the old official text no longer resolves to the catalog.
      { 'urrea_catalog.select': { data: [], error: null } },
    )
    activeClient = db.client
    const res = await patchUpdate(body([
      product({ _dbId: lineId(1), etm: 'ETM-1', model_code: 'MC1', unit_price: 120, dymmsa_description: 'Oficial URREA vieja' }),
      product({ _dbId: lineId(2), etm: 'ETM-2', model_code: 'MC2', dymmsa_description: 'Curada editada' }),
    ]))
    expect(res.status).toBe(200)
    // The quotation keeps its frozen snapshot (ADR-013 rule 2).
    expect(db.lines()[0].dymmsa_description).toBe('Oficial URREA vieja')

    const updates = new Map(db.client.callsTo('etm_products', 'update').map((c) => [filterValue(c, 'etm'), c.payload]))
    expect(updates.get('ETM-1')).toEqual({ price: 120 })
    expect(updates.get('ETM-2')).toEqual({ dymmsa_description: 'Curada editada' })
  })
})

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
              { id: 'sep', item_type: 'separator', section_label: 'A', separator_color: 'violet', sort_order: 0 },
              { id: 'p1', item_type: 'product', is_approved: true,  sort_order: 1, model_code: 'MC1', quantity: 3, unit_price: 100, etm: 'E1', brand: 'URREA' },
              { id: 'p2', item_type: 'product', is_approved: false, sort_order: 2, model_code: 'MC2', quantity: 5, unit_price: 50,  etm: 'E2', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 10 }, error: null }, // stock covers the 3 of MC1
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
    expect(body.items_count).toBe(1)       // 1 approved product
    expect(body.total_amount).toBe(300)    // 100*3 (rejected p2 excluded)

    // The link is what "Ver orden" and the reopen/delete guards look up (ADR-010).
    expect(activeClient.insertPayload<Record<string, unknown>>('orders')).toMatchObject({
      quotation_id: 'q1', name: 'Q', customer_name: 'ACME', status: 'ordered',
    })

    const items = activeClient.insertPayload('order_items')
    expect(items).toHaveLength(2)          // separator + approved p1
    expect(items.map((i) => i.item_type)).toEqual(['separator', 'product'])
    // the separator color travels to the order (#73)
    expect(items[0].separator_color).toBe('violet')
    const p1 = items.find((i) => i.item_type === 'product')!
    expect(p1.quantity_approved).toBe(3)
    expect(p1.quantity_in_stock).toBe(3)   // stock 10 covers the 3
    expect(p1.quantity_to_order).toBe(0)

    // deducted inventory and marked the quotation as converted
    expect(activeClient.didCall('store_inventory', 'update')).toBe(true)
    const upd = activeClient.updatePayload('quotations')
    expect(upd.status).toBe('converted_to_order')
  })

  test('REGLA: excluye "no lo vendemos" (is_sold=false) aunque esté is_approved=true', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: true, is_sold: null,  sort_order: 0, model_code: 'MC1', quantity: 2, unit_price: 100, etm: 'E1', brand: 'URREA' },
              { id: 'p2', item_type: 'product', is_approved: true, is_sold: false, sort_order: 1, model_code: 'MC2', quantity: 9, unit_price: 999, etm: 'E2', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 0 }, error: null },
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': { data: null, error: null },
        'quotations.update': { data: null, error: null },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.items_count).toBe(1)     // only p1; p2 (not sold) excluded
    expect(body.total_amount).toBe(200)  // 100*2, without p2's 999
    const items = activeClient.insertPayload('order_items')
    expect(items.every((i) => i.etm !== 'E2')).toBe(true)
  })

  test('REGLA: snapshot de location desde store_inventory al order_item', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: true, sort_order: 0, model_code: 'MC1', quantity: 2, unit_price: 100, etm: 'E1', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 10, location: 'A-12' }, error: null },
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': { data: null, error: null },
        'store_inventory.update': { data: null, error: null },
        'quotations.update': { data: null, error: null },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(200)
    const items = activeClient.insertPayload('order_items')
    const p1 = items.find((i) => i.item_type === 'product')!
    expect(p1.location).toBe('A-12')
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
              // Approved with quantity 0 → violates quantity_approved_check on insert
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
    expect(res.status).toBe(400) // rule violation, not a 500
    const body = await res.json()
    expect(body.offendingEtm).toBe('BAD-1')
    expect(body.message).toContain('BAD-1')
    expect(body.message).toMatch(/cantidad/i)
    expect(activeClient.didCall('orders', 'delete')).toBe(true) // rollback anyway
  })

  test('REGLA: segunda orden de la misma cotización (índice único) → 400 sin tocar stock ni estado', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: true, sort_order: 0, model_code: 'MC1', quantity: 2, unit_price: 10, etm: 'E1', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 10 }, error: null },
        'orders.insert': {
          data: null,
          error: {
            code: '23505',
            message: 'duplicate key value violates unique constraint "orders_quotation_id_unique"',
          },
        },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/ya tiene una orden/i)
    expect(activeClient.didCall('order_items', 'insert')).toBe(false)
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
    expect(activeClient.didCall('quotations', 'update')).toBe(false)
  })

  test('falla del insert de la orden sin violar una regla → 500 genérico', async () => {
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
        'orders.insert': { data: null, error: { message: 'connection reset' } },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(500)
    expect((await res.json()).message).toBe('Error al crear la orden')
  })

  test('REGLA: si falla marcar la cotización como convertida → rollback de la orden antes de tocar stock', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': {
          data: {
            id: 'q1', name: 'Q', customer_name: 'ACME', status: 'approved',
            quotation_items: [
              { id: 'p1', item_type: 'product', is_approved: true, sort_order: 0, model_code: 'MC1', quantity: 2, unit_price: 10, etm: 'E1', brand: 'URREA' },
            ],
          },
          error: null,
        },
        'store_inventory.select': { data: { quantity: 10 }, error: null },
        'orders.insert': { data: { id: 'o1' }, error: null },
        'order_items.insert': { data: null, error: null },
        'quotations.update': { data: null, error: { message: 'connection reset' } },
      },
    })
    const res = await createOrder.POST(makeRequest(), makeParams({ id: 'q1' }))
    expect(res.status).toBe(500)
    const rollback = activeClient.callsTo('orders', 'delete')
    expect(rollback).toHaveLength(1)
    expect(filterValue(rollback[0], 'id')).toBe('o1')
    // A linked order behind an 'approved' quotation would be a dead end (ADR-010).
    expect(activeClient.didCall('store_inventory', 'update')).toBe(false)
  })
})

describe('DELETE /quotations/[id]', () => {
  const del = () => quotationRoute.DELETE(makeRequest(undefined, { method: 'DELETE' }), makeParams({ id: 'q1' }))

  test('401 sin usuario autenticado', async () => {
    activeClient = createMockSupabase({ user: null })
    expect((await del()).status).toBe(401)
  })

  test('404 si la cotización no existe', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: { 'quotations.select': { data: null, error: { code: 'PGRST116', message: 'nf' } } },
    })
    expect((await del()).status).toBe(404)
    expect(activeClient.didCall('quotations', 'delete')).toBe(false)
  })

  test('GUARDA: con orden vinculada → 400 y no borra nada (ADR-010)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1' }, error: null },
        'orders.select': { data: [{ id: 'o1' }], error: null },
      },
    })
    const res = await del()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toBe('Elimina la orden vinculada antes de eliminar esta cotización.')
    const lookup = activeClient.callsTo('orders', 'select')[0]
    expect(filterValue(lookup, 'quotation_id')).toBe('q1')
    expect(activeClient.didCall('quotations', 'delete')).toBe(false)
    expect(activeClient.didCall('quotation_items', 'delete')).toBe(false)
  })

  test('sin orden vinculada → 200 con un solo delete de la cotización (los ítems caen en cascada)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1' }, error: null },
        'orders.select': { data: [], error: null },
        'quotations.delete': { data: null, error: null },
      },
    })
    const res = await del()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ success: true })
    const deletes = activeClient.callsTo('quotations', 'delete')
    expect(deletes).toHaveLength(1)
    expect(filterValue(deletes[0], 'id')).toBe('q1')
    expect(activeClient.didCall('quotation_items', 'delete')).toBe(false)
  })

  test('si el delete falla → 500, no { success: true }', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1' }, error: null },
        'orders.select': { data: [], error: null },
        'quotations.delete': { data: null, error: { code: 'XX000', message: 'boom' } },
      },
    })
    const res = await del()
    expect(res.status).toBe(500)
    expect((await res.json()).message).toBe('Error al eliminar la cotización')
  })

  test('si una orden se liga entre la revisión y el delete (FK 23503) → 400 con el mismo mensaje', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1' }, error: null },
        'orders.select': { data: [], error: null },
        'quotations.delete': {
          data: null,
          error: { code: '23503', message: 'update or delete on table "quotations" violates foreign key constraint "orders_quotation_id_fkey"' },
        },
      },
    })
    const res = await del()
    expect(res.status).toBe(400)
    expect((await res.json()).message).toMatch(/elimina la orden vinculada/i)
  })

  test('si falla la búsqueda de la orden vinculada → 500 sin borrar', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1' }, error: null },
        'orders.select': { data: null, error: { message: 'boom' } },
      },
    })
    expect((await del()).status).toBe(500)
    expect(activeClient.didCall('quotations', 'delete')).toBe(false)
  })
})

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

  test('regenera approval_token al cambiar de estado (mata el link viejo)', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'approved' }, error: null },
        'quotations.update': { data: { id: 'q1', status: 'draft' }, error: null },
      },
    })
    await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    const payload = activeClient.updatePayload<{ approval_token?: string }>('quotations')
    expect(typeof payload.approval_token).toBe('string')
    expect(payload.approval_token).toMatch(/[0-9a-f-]{36}/i)
  })

  test('sella approved_at al marcar approved por primera vez; lo PRESERVA en otros estados', async () => {
    // 1. Marks approved with no previous date → stamps it now.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'sent_for_approval', approved_at: null }, error: null },
        'quotations.update': { data: { id: 'q1', status: 'approved' }, error: null },
      },
    })
    await status.PATCH(makeRequest({ status: 'approved' }), makeParams({ id: 'q1' }))
    expect(activeClient.updatePayload<{ approved_at?: string | null }>('quotations').approved_at).toBeTruthy()

    // 2. Leaves approved → not cleared: approved_at absent from the payload = preserved.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'approved', approved_at: '2026-07-01T10:00:00Z' }, error: null },
        'quotations.update': { data: { id: 'q1', status: 'draft' }, error: null },
      },
    })
    await status.PATCH(makeRequest({ status: 'draft' }), makeParams({ id: 'q1' }))
    expect('approved_at' in activeClient.updatePayload('quotations')).toBe(false)

    // 3. Re-marks approved with a previous date → keeps the original.
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'sent_for_approval', approved_at: '2026-07-01T10:00:00Z' }, error: null },
        'quotations.update': { data: { id: 'q1', status: 'approved' }, error: null },
      },
    })
    await status.PATCH(makeRequest({ status: 'approved' }), makeParams({ id: 'q1' }))
    expect('approved_at' in activeClient.updatePayload('quotations')).toBe(false)
  })

  test('GUARDA: converted_to_order con orden vinculada (cualquier estado) → 400', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'converted_to_order' }, error: null },
        // The order exists (even a cancelled one blocks: it has to be deleted).
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

  test('GUARDA: si falla la búsqueda de la orden vinculada → 500 sin reabrir', async () => {
    activeClient = createMockSupabase({
      user: AUTH,
      responses: {
        'quotations.select': { data: { id: 'q1', status: 'converted_to_order' }, error: null },
        'orders.select': { data: null, error: { message: 'boom' } },
      },
    })
    const res = await status.PATCH(makeRequest({ status: 'approved' }), makeParams({ id: 'q1' }))
    expect(res.status).toBe(500)
    expect(activeClient.didCall('quotations', 'update')).toBe(false)
  })
})
