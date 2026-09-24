/** MCP payables tools (#109, ADR-030): reads digest the rows, writes apply the route's rules; the mock plays the table. */

import { describe, test, expect } from 'vitest'
import { createMockSupabase, filterValue, hasFilter, type CallRecord } from '../helpers/supabase-mock'
import { type Db } from '@/lib/mcp/shared'
import { createPayable, getPayable, getPayablesOverview, listPayables, markPayablePaid, resolvePayable } from '@/lib/mcp/tools/payables'
import { daysUntilDue, dueDateFrom } from '@/lib/payables'
import { todayInMexico } from '@/lib/format'

const asDb = (c: ReturnType<typeof createMockSupabase>) => c as unknown as Db

const TODAY = todayInMexico()
const MONTH = TODAY.slice(0, 7)
const PERFILES = { id: 's-perf', name: 'Perfiles del Bajío', payment_terms_days: 30 }
const TORNILLOS = { id: 's-torn', name: 'Tornillos MX', payment_terms_days: null }
const SUPPLIERS = [PERFILES, TORNILLOS]

type Row = ReturnType<typeof row>
const row = (id: string, supplier: typeof PERFILES, concept: string, amount: number, due: string, status = 'pending', paidAt: string | null = null) => ({
  id, supplier_id: supplier.id, concept, amount, invoice_date: due, due_date: due, status, paid_at: paidAt, notes: null,
  created_at: '', updated_at: '', supplier,
})

/** suppliers as the lookups query them: ilike on name. */
const suppliers = (rec: CallRecord) => {
  const like = rec.filters.find((f) => f.method === 'ilike')?.args[1] as string | undefined
  const needle = like?.replace(/%/g, '').toLowerCase() ?? ''
  return { data: SUPPLIERS.filter((s) => s.name.toLowerCase().includes(needle)), error: null }
}

/** payables as PostgREST would answer: by id, by status, by the `or` search, by due/paid ranges. */
function payables(rows: Row[]) {
  return (rec: CallRecord) => {
    if (rec.op === 'update') {
      const target = rows.find((r) => r.id === filterValue(rec, 'id'))
      return { data: target ? { ...target, ...(rec.payload as object) } : null, error: target ? null : { code: 'PGRST116' } }
    }
    if (rec.op === 'insert') {
      return { data: { ...(rec.payload as object), id: 'new', supplier: PERFILES, created_at: '', updated_at: '' }, error: null }
    }
    const id = filterValue(rec, 'id')
    if (id) {
      const found = rows.find((r) => r.id === id) ?? null
      return { data: found, error: found ? null : { code: 'PGRST116' } }
    }
    let out = rows
    const status = filterValue(rec, 'status')
    if (status) out = out.filter((r) => r.status === status)
    const or = rec.filters.find((f) => f.method === 'or')?.args[0] as string | undefined
    if (or) {
      const concept = /concept\.ilike\.%(.*?)%/.exec(or)?.[1]?.toLowerCase() ?? ''
      const ids = /supplier_id\.in\.\((.*?)\)/.exec(or)?.[1]?.split(',') ?? []
      out = out.filter((r) => r.concept.toLowerCase().includes(concept) || ids.includes(r.supplier_id))
    }
    for (const col of ['due_date', 'paid_at'] as const) {
      const from = filterValue(rec, col, 'gte') as string | undefined
      const to = filterValue(rec, col, 'lt') as string | undefined
      if (from) out = out.filter((r) => (r[col] ?? '') >= from)
      if (to) out = out.filter((r) => (r[col] ?? '') < to)
    }
    return { data: out, count: out.length, error: null }
  }
}

const client = (rows: Row[], extra: Record<string, unknown> = {}) =>
  createMockSupabase({ responses: { suppliers, payables: payables(rows), ...extra } })

/** dueDateFrom clamps negative days to 0 on purpose; tests need real past dates. */
const shiftDays = (iso: string, days: number) => {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}
const IN_5 = shiftDays(TODAY, 5)
const AGO_10 = shiftDays(TODAY, -10)

describe('listPayables', () => {
  test('digiere con días para vencer y aplica los filtros a la query', async () => {
    // Anchored inside the month: the mock applies the due_date range, relative dates would cross it (review PR #111).
    const due1 = `${MONTH}-05`
    const c = client([row('p1', PERFILES, 'Perfiles junio', 1500, due1), row('p2', TORNILLOS, 'Tornillería', 200, `${MONTH}-20`)])
    const result = await listPayables(asDb(c), { estado: 'pending', mes: MONTH, proveedor: 'perfiles', concepto: 'junio' })

    const call = c.callsTo('payables', 'select')[0]
    expect(filterValue(call, 'status')).toBe('pending')
    expect(filterValue(call, 'due_date', 'gte')).toBe(`${MONTH}-01`)
    expect(hasFilter(call, 'due_date', 'lt')).toBe(true)
    expect(filterValue(call, 'supplier_id')).toBe('s-perf')
    expect(filterValue(call, 'concept', 'ilike')).toBe('%junio%')
    // The mock ignores ilike/supplier_id, the shape is what matters here.
    expect(result.facturas[0]).toMatchObject({ proveedor: 'Perfiles del Bajío', monto: 1500, dias_para_vencer: daysUntilDue(due1, TODAY), estado: 'Pendiente' })
    expect(result.suma_mostrada).toBe(1700)
  })

  test('estado o mes inválidos → error antes de consultar', async () => {
    const c = client([])
    await expect(listPayables(asDb(c), { estado: 'pagada' })).rejects.toThrow(/Estado inválido/)
    await expect(listPayables(asDb(c), { mes: '09-2026' })).rejects.toThrow(/Mes inválido/)
    expect(c.callsTo('payables', 'select')).toHaveLength(0)
  })
})

describe('resolvePayable / getPayable', () => {
  const rows = [
    row('11111111-1111-4111-8111-111111111111', PERFILES, 'Perfiles junio', 1500, AGO_10, 'paid', AGO_10),
    row('p2', PERFILES, 'Perfiles julio', 1800, IN_5),
    row('p3', TORNILLOS, 'Tornillería', 200, IN_5),
  ]

  test('por nombre del proveedor encuentra sus facturas; prefiere el estado pedido y lista si hay varias', async () => {
    await expect(resolvePayable(asDb(client(rows)), 'perfiles')).rejects.toThrow(/2 coincidencias \(Perfiles del Bajío · Perfiles junio/)
    const pending = await resolvePayable(asDb(client(rows)), 'perfiles', 'pending')
    expect(pending.id).toBe('p2')
    // No pending match falls back to any status (to correct a date, say).
    const fallback = await resolvePayable(asDb(client(rows)), 'junio', 'pending')
    expect(fallback.concept).toBe('Perfiles junio')
    await expect(resolvePayable(asDb(client(rows)), 'zzz')).rejects.toThrow(/No hay factura por pagar que coincida/)
  })

  test('admin: detalle con historial descrito; member: ni la llave del historial (ADR-028)', async () => {
    const events = [
      { id: 2, action: 'status_changed', actor_name: 'Tania', data: { to: { status: 'paid', paid_at: AGO_10 } }, created_at: '2026-09-10T10:00:00Z' },
      { id: 1, action: 'created', actor_name: 'Tania', data: {}, created_at: '2026-09-01T10:00:00Z' },
    ]
    const asAdmin = client(rows, { profiles: { data: { role: 'admin' } }, audit_events: { data: events } })
    const admin = await getPayable(asDb(asAdmin), 'u-admin', rows[0].id)
    expect('historial' in admin && admin.historial.map((h) => h.que)).toEqual([`Marcada como pagada el ${AGO_10}`, 'Registrada'])
    expect(admin.plazo_proveedor_dias).toBe(30)
    expect(filterValue(asAdmin.callsTo('profiles', 'select')[0], 'id')).toBe('u-admin')

    const asMember = client(rows, { profiles: { data: { role: 'member' } }, audit_events: { data: events } })
    const member = await getPayable(asDb(asMember), 'u-member', rows[0].id)
    expect(member).toMatchObject({ concepto: 'Perfiles junio', estado: 'Pagada' })
    expect(Object.keys(member)).not.toContain('historial')
    expect(Object.keys(member)).not.toContain('nota')
    // The trail is not even queried for a member.
    expect(asMember.callsTo('audit_events', 'select')).toHaveLength(0)

    await expect(getPayable(asDb(client(rows)), 'u-x', '99999999-9999-4999-8999-999999999999')).rejects.toThrow(/Factura no encontrada/)
  })
})

describe('markPayablePaid (escritura)', () => {
  const rows = [
    row('p2', PERFILES, 'Perfiles julio', 1800, IN_5),
    row('p1', PERFILES, 'Perfiles junio', 1500, AGO_10, 'paid', AGO_10),
    row('p9', TORNILLOS, 'Cancelada', 50, IN_5, 'cancelled'),
  ]

  test('pendiente → pagada hoy (fecha real de México) y solo esa fila', async () => {
    const c = client(rows)
    const result = await markPayablePaid(asDb(c), { factura: 'julio' })
    const update = c.callsTo('payables', 'update')[0]
    expect(update.payload).toEqual({ status: 'paid', paid_at: TODAY })
    expect(filterValue(update, 'id')).toBe('p2')
    expect(result).toMatchObject({ estado: 'Pagada', pagada_el: TODAY })
    expect(result.nota).toMatch(/bitácora registra quién/)
  })

  test('con fecha_pago la respeta; pagada=false regresa a pendiente y limpia la fecha', async () => {
    const c = client(rows)
    await markPayablePaid(asDb(c), { factura: 'julio', fecha_pago: AGO_10 })
    expect(c.updatePayload('payables')).toEqual({ status: 'paid', paid_at: AGO_10 })

    const back = client(rows)
    const result = await markPayablePaid(asDb(back), { factura: 'junio', pagada: false })
    expect(back.updatePayload('payables')).toEqual({ status: 'pending', paid_at: null })
    expect(result.nota).toMatch(/Regresada a pendiente/)
  })

  test('guardas: ya pagada sin fecha no re-sella hoy; cancelada y ya-pendiente avisan; fecha inválida', async () => {
    await expect(markPayablePaid(asDb(client(rows)), { factura: 'junio' })).rejects.toThrow(new RegExp(`ya estaba pagada el ${AGO_10}`))
    await expect(markPayablePaid(asDb(client(rows)), { factura: 'Cancelada' })).rejects.toThrow(/está cancelada/)
    await expect(markPayablePaid(asDb(client(rows)), { factura: 'julio', pagada: false })).rejects.toThrow(/ya está pendiente/)
    const c = client(rows)
    await expect(markPayablePaid(asDb(c), { factura: 'julio', fecha_pago: '10/09/2026' })).rejects.toThrow(/Fecha de pago inválida/)
    expect(c.callsTo('payables', 'update')).toHaveLength(0)
  })
})

describe('createPayable (escritura)', () => {
  test('nace pendiente con el vencimiento calculado con el plazo del proveedor', async () => {
    const c = client([])
    const result = await createPayable(asDb(c), { proveedor: 'perfiles', concepto: ' Perfiles agosto ', monto: 2500, fecha_factura: TODAY })
    expect(c.insertPayload<Record<string, unknown>>('payables')).toEqual({
      supplier_id: 's-perf', concept: 'Perfiles agosto', amount: 2500, invoice_date: TODAY,
      due_date: dueDateFrom(TODAY, 30), status: 'pending', paid_at: null, notes: null,
    })
    expect(result).toMatchObject({ estado: 'Pendiente', proveedor: 'Perfiles del Bajío' })
    expect(result.nota).toMatch(/\(1 mes\)/)
  })

  test('vencimiento explícito manda; contado = mismo día', async () => {
    const explicit = client([])
    await createPayable(asDb(explicit), { proveedor: 'perfiles', concepto: 'x', monto: 1, fecha_factura: TODAY, vencimiento: IN_5 })
    expect(explicit.insertPayload<Record<string, unknown>>('payables').due_date).toBe(IN_5)

    const cash = client([])
    const result = await createPayable(asDb(cash), { proveedor: 'tornillos', concepto: 'x', monto: 1, fecha_factura: TODAY })
    expect(cash.insertPayload<Record<string, unknown>>('payables').due_date).toBe(TODAY)
    expect(result.nota).toMatch(/\(Contado\)/)
  })

  test('mismas validaciones que la ruta, antes de tocar la BD', async () => {
    const c = client([])
    await expect(createPayable(asDb(c), { proveedor: 'perfiles', concepto: ' ', monto: 1, fecha_factura: TODAY })).rejects.toThrow(/concepto es obligatorio/)
    await expect(createPayable(asDb(c), { proveedor: 'perfiles', concepto: 'x', monto: 0, fecha_factura: TODAY })).rejects.toThrow(/mayor a 0/)
    await expect(createPayable(asDb(c), { proveedor: 'perfiles', concepto: 'x', monto: 1, fecha_factura: '24/09/2026' })).rejects.toThrow(/Fecha de factura inválida/)
    await expect(createPayable(asDb(c), { proveedor: 'nadie', concepto: 'x', monto: 1, fecha_factura: TODAY })).rejects.toThrow(/No hay proveedor/)
    expect(c.callsTo('payables', 'insert')).toHaveLength(0)
  })
})

describe('getPayablesOverview', () => {
  test('pendiente del mes por semana, vencido con arrastre, pagado del mes y próximas', async () => {
    const lastMonthDue = shiftDays(`${MONTH}-01`, -3)
    const c = client([
      row('a', PERFILES, 'Arrastre', 100, lastMonthDue),
      row('b', TORNILLOS, 'Este mes', 250, `${MONTH}-10`),
      row('c', PERFILES, 'Pagada', 900, `${MONTH}-03`, 'paid', `${MONTH}-03`),
    ])
    const result = await getPayablesOverview(asDb(c), { mes: MONTH })
    expect(result.pendiente_del_mes).toEqual({ total: 250, facturas: 1 })
    expect(result.vencido.de_meses_anteriores).toEqual({ total: 100, facturas: 1 })
    expect(result.pagado_en_el_mes).toEqual({ total: 900, facturas: 1 })
    expect(result.semanas_del_mes).toEqual([{ semana: 'Semana 2', total: 250, facturas: 1 }])
    expect(result.proximas.map((p) => p.concepto)).toEqual(['Arrastre', 'Este mes'])
    expect(result.nota).toBeNull()
    // Paid read is bounded to the month by paid_at.
    const paidRead = c.callsTo('payables', 'select').find((r) => filterValue(r, 'status') === 'paid')
    expect(filterValue(paidRead!, 'paid_at', 'gte')).toBe(`${MONTH}-01`)
  })
})
