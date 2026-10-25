/**
 * odoo_create_draft_invoice (#144, ADR-040; two phases since #155 B2b). The real facade and write catalog
 * run over fakes: nothing reaches Odoo nor Supabase, and account.move is only ever read.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest'
import { createMockSupabase } from '../helpers/supabase-mock'
import { fakeOdoo, fakeWriter, throwingWriter, type OdooScript } from '../helpers/fake-odoo'
import {
  commitDraftInvoice,
  planDraftInvoice,
  SUMMARY_LINES_MAX,
  type DraftInvoiceInput,
  type DraftInvoiceSummary,
} from '@/lib/mcp/tools/odoo/draft-invoice'
import type { OdooQuotationDeps } from '@/lib/mcp/tools/odoo/quotations'
import type { Db } from '@/lib/mcp/core/db'
import { OdooUncertainWriteError } from '@/lib/odoo/client'
import { trailNote } from '@/lib/odoo/writer'
import { ADMIN_ONLY_MESSAGE } from '@/lib/auth/admin-proof'
import type { McpRole } from '@/lib/mcp/manifest'

// 17:00 in Morelia (UTC-6).
const NOW = Date.UTC(2026, 9, 17, 23, 0)
const STAMP = '2026-10-17 17:00'

beforeEach(() => {
  vi.stubEnv('ODOO_URL', 'https://odoo.test')
  vi.stubEnv('ODOO_WRITE_API_KEY', 'write-key-0123456789abcdef')
  vi.stubEnv('ODOO_DB', '')
  vi.useFakeTimers({ toFake: ['Date'], now: NOW })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

function context(opts: { role?: McpRole; profileRole?: string } = {}) {
  const client = createMockSupabase({
    responses: { profiles: { data: { role: opts.profileRole ?? 'admin', display_name: 'Ana Admin' } } },
  })
  return { ctx: { db: client as unknown as Db, userId: 'admin-1', role: opts.role ?? 'admin' } }
}

const COMPANY_NAME = 'DISTRIBUCIONES Y MANUFACTURAS DE MICHOACAN'
const ORIGINAL_NOTE = '<p>Confirmada por el asistente a petición de Ana Admin · 2026-10-17 16:50 · clave 0123456789</p>'
/** What both phases receive: the core adds and strips the clave (#155 C4). */
const INPUT: DraftInvoiceInput = { folio: 'S00912' }
type Ctx = ReturnType<typeof context>['ctx']

/** Phase 1: reads and summarizes, never writes. */
const summaryOf = async (deps: OdooQuotationDeps, ctx: Ctx, input: DraftInvoiceInput = INPUT) =>
  (await planDraftInvoice(deps, ctx, input)).entity.value as DraftInvoiceSummary

/** Phase 2 as the core runs it: the plan it just made, then the write. */
const confirm = async (deps: OdooQuotationDeps, ctx: Ctx, input: DraftInvoiceInput = INPUT) =>
  commitDraftInvoice(deps, await planDraftInvoice(deps, ctx, input))
const ALREADY_NOTE =
  'Nada que crear: la venta ya tiene una factura en borrador. Revisarla, publicarla y timbrarla se hace en Odoo; el asistente nunca timbra.'
const MISSING_TRAIL =
  'La nota interna de la S00912 no dice que el asistente creó este borrador: si fue un intento anterior que quedó incierto, anota en Odoo quién lo pidió.'

function saleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 912,
    name: 'S00912',
    state: 'sale',
    invoice_status: 'to invoice',
    amount_untaxed: 2,
    amount_total: 2.32,
    currency_id: [33, 'MXN'],
    partner_id: [1, COMPANY_NAME],
    invoice_ids: [],
    picking_ids: [],
    internal_note: ORIGINAL_NOTE,
    ...overrides,
  }
}

const NOTE_LINE = {
  id: 7001, name: 'PRUEBA #144 — no procesar', display_type: 'line_note', product_id: false, is_downpayment: false,
  product_uom_qty: 0, qty_delivered: 0, qty_invoiced: 0, qty_to_invoice: 0, price_unit: 0,
}

function lineRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 7002, name: 'Re pintado', display_type: false, product_id: [30888, 'Re pintado'], is_downpayment: false,
    product_uom_qty: 2, qty_delivered: 0, qty_invoiced: 0, qty_to_invoice: 2, price_unit: 1, price_subtotal: 2,
    ...overrides,
  }
}

const REPINTADO = { id: 30888, name: 'Re pintado', type: 'service', invoice_policy: 'order', unspsc_code_id: [53100, '73181104 Painting services'] }
const MANGO = { id: 16971, name: '5467 Mango articulado cromado URREA', type: 'consu', invoice_policy: 'delivery', unspsc_code_id: false }
const MANGO_LINE = lineRow({ id: 7003, name: MANGO.name, product_id: [16971, MANGO.name], qty_to_invoice: 0 })

function invoiceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1300,
    name: false,
    state: 'draft',
    move_type: 'out_invoice',
    auto_post: 'no',
    is_move_sent: false,
    sending_data: false,
    l10n_mx_edi_cfdi_state: false,
    amount_total: 2.32,
    currency_id: [33, 'MXN'],
    ...overrides,
  }
}

/** A confirmed service sale, ready to invoice; the second sale.order read is the post-write check. */
const readyScript = (overrides: OdooScript = {}): OdooScript => ({
  'sale.order.search_read': [[saleRow()], [{ id: 912, invoice_ids: [1300] }]],
  'sale.order.line.search_read': [[NOTE_LINE, lineRow()]],
  'product.product.search_read': [[REPINTADO]],
  'account.move.search_read': [[invoiceRow()]],
  ...overrides,
})

/** Preconditions are read by the plan, which both phases run (#155 C4): the same refusal, and nothing may be written. */
async function refused(script: OdooScript, folio = INPUT.folio) {
  const { odoo, calls } = fakeOdoo(script)
  const { writer, attempts } = throwingWriter()
  const error = await planDraftInvoice({ reader: odoo, writer }, context().ctx, { folio }).catch((e: unknown) => e)
  expect(attempts).toEqual([])
  expect(error).toBeInstanceOf(Error)
  return { message: (error as Error).message, calls }
}

const WIZARD_CONTEXT = { active_model: 'sale.order', active_ids: [912], active_id: 912 }

describe('rechazos', () => {
  test('un member o un admin degradado no llega a Odoo: cero llamadas', async () => {
    for (const who of [context({ role: 'member' }), context({ profileRole: 'member' })]) {
      const { odoo, calls } = fakeOdoo({})
      const { writer, attempts } = throwingWriter()
      await expect(planDraftInvoice({ reader: odoo, writer }, who.ctx, INPUT)).rejects.toThrow(ADMIN_ONLY_MESSAGE)
      expect(calls).toEqual([])
      expect(attempts).toEqual([])
    }
  })

  test('sin llave de escritura no lee ni escribe nada', async () => {
    vi.stubEnv('ODOO_WRITE_API_KEY', '')
    const { message, calls } = await refused({})
    expect(message).toBe('La escritura en Odoo está deshabilitada en este servidor (falta ODOO_WRITE_API_KEY).')
    expect(calls).toEqual([])
  })

  test('solo desde una venta confirmada', async () => {
    for (const state of ['draft', 'sent']) {
      const { message, calls } = await refused({ 'sale.order.search_read': [[saleRow({ state })]] })
      expect(message).toBe('La S00912 sigue como cotización: primero confírmala (vista previa con el folio y, con tu sí, odoo_confirm_quotation).')
      // Nothing else is read: the wizard is never reached.
      expect(calls).toHaveLength(1)
    }
    const cancelled = await refused({ 'sale.order.search_read': [[saleRow({ state: 'cancel' })]] })
    expect(cancelled.message).toBe('La S00912 está cancelada.')
  })

  test('bienes sin entregar → nombra la entrega, cero escrituras', async () => {
    const { message, calls } = await refused({
      'sale.order.search_read': [[saleRow({ invoice_status: 'no', picking_ids: [650] })]],
      'sale.order.line.search_read': [[MANGO_LINE]],
      'product.product.search_read': [[MANGO]],
      'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'assigned' }]],
    })
    expect(message).toBe(
      'Nada que facturar todavía: 1 bien se factura por entrega y la entrega OFI/OUT/00650 está «Lista», sin validar. Valídala en Odoo y vuelve a pedírmelo. El asistente no toca inventario.',
    )
    // Inventory is read, never touched.
    expect(calls.filter((c) => c.model === 'stock.picking').map((c) => c.method)).toEqual(['search_read'])
  })

  test('entrega parcial, facturación previa o anticipo → error', async () => {
    const partial = await refused({
      'sale.order.search_read': [[saleRow({ picking_ids: [650] })]],
      'sale.order.line.search_read': [[lineRow(), { ...MANGO_LINE, qty_delivered: 1, qty_to_invoice: 1 }]],
      'product.product.search_read': [[REPINTADO, MANGO]],
      'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'assigned' }]],
    })
    expect(partial.message).toBe('Solo está entregada una parte (1 de 2 líneas): la factura del asistente es siempre completa.')

    const posted = await refused({
      'sale.order.search_read': [[saleRow({ invoice_ids: [1210] })]],
      'account.move.search_read': [[{ id: 1210, name: 'F00609', state: 'posted', move_type: 'out_invoice', amount_total: 2.32 }]],
      'sale.order.line.search_read': [[lineRow()]],
      'product.product.search_read': [[REPINTADO]],
    })
    expect(posted.message).toBe('La S00912 ya está facturada (F00609): las facturas parciales o adicionales se hacen en Odoo.')

    const downpayment = await refused({
      'sale.order.line.search_read': [[lineRow(), lineRow({ id: 7009, name: 'Anticipo', is_downpayment: true })]],
      'sale.order.search_read': [[saleRow()]],
      'product.product.search_read': [[REPINTADO]],
    })
    expect(downpayment.message).toBe('La S00912 tiene anticipos: la factura final hazla en Odoo.')
  })

  test('total cero o negativo, precio o cantidad negativa o sobre-entrega → error, cero escrituras', async () => {
    const creditNote = 'Odoo convertiría la S00912 en nota de crédito: hazla en Odoo.'
    const cases: [string, Record<string, unknown>, Record<string, unknown>[], string][] = [
      ['total cero', { amount_total: 0 }, [lineRow()], creditNote],
      ['precio negativo', {}, [lineRow(), lineRow({ id: 7004, name: 'Descuento', price_unit: -5 })], creditNote],
      ['cantidad negativa', {}, [lineRow({ qty_to_invoice: -1 })], creditNote],
      ['sobre-entrega', {}, [lineRow({ qty_to_invoice: 3 })], 'Se entregó más de lo vendido en «Re pintado»: ajusta la venta o factura en Odoo.'],
      ['upselling', { invoice_status: 'upselling' }, [lineRow({ qty_delivered: 3 })], 'Se entregó más de lo vendido en «Re pintado»: ajusta la venta o factura en Odoo.'],
    ]
    for (const [label, sale, lines, expected] of cases) {
      const { message } = await refused({
        'sale.order.search_read': [[saleRow(sale)]],
        'sale.order.line.search_read': [lines],
        'product.product.search_read': [[REPINTADO]],
      })
      expect(message, label).toBe(expected)
    }
  })

  test('el folio debe ser exacto', async () => {
    const near = await refused({ 'sale.order.search_read': [[], [{ id: 912, name: 'S00912' }]] }, 'S000912')
    expect(near.message).toBe('No hay ninguna venta S000912 en Odoo. ¿Quisiste decir S00912? Pásame el folio completo.')
    // The exact folio first, a near one only suggested.
    expect(near.calls[0].payload.domain).toEqual([['name', '=', 'S000912']])

    const malformed = await refused({}, '912')
    expect(malformed.message).toMatch(/^Entrada inválida en odoo_create_draft_invoice: «folio»: folio de venta de Odoo, ej\. S00912/)
    expect(malformed.calls).toEqual([])
  })

  test('más líneas de las que puedo leer completas → se factura en Odoo', async () => {
    const many = Array.from({ length: 201 }, (_, i) => lineRow({ id: 9000 + i }))
    const { message } = await refused({ 'sale.order.search_read': [[saleRow()]], 'sale.order.line.search_read': [many] })
    expect(message).toBe('La S00912 tiene más de 200 líneas: factúrala en Odoo.')
  })
})

describe('resumen sin confirmar (#155 B2b)', () => {
  test('lee lo mismo que la escritura y no escribe nada: cliente, total, líneas, entrega y que no hay borrador', async () => {
    const delivered = { ...MANGO_LINE, qty_delivered: 2, qty_to_invoice: 2, price_subtotal: 1901.96 }
    const script = readyScript({
      'sale.order.search_read': [[saleRow({ picking_ids: [650], amount_untaxed: 1903.96, amount_total: 2208.59 })]],
      'sale.order.line.search_read': [[NOTE_LINE, lineRow(), delivered]],
      'product.product.search_read': [[REPINTADO, MANGO]],
      'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'done' }]],
    })
    const { odoo, calls } = fakeOdoo(script)
    const { writer, ops, calls: writes } = fakeWriter()
    const result = await summaryOf({ reader: odoo, writer }, context().ctx)

    expect(ops).toEqual([])
    expect(writes).toEqual([])
    expect(calls.every((c) => c.method === 'search_read')).toBe(true)
    expect(calls.map((c) => c.model)).toEqual(['sale.order', 'sale.order.line', 'product.product', 'stock.picking'])
    expect(result).toEqual({
      venta: { folio: 'S00912', id: 912, cliente: COMPANY_NAME },
      a_facturar: { subtotal: 1903.96, total: 2208.59, moneda: 'MXN' },
      lineas: [
        { producto: 'Re pintado', cantidad: 2, importe: 2 },
        { producto: MANGO.name, cantidad: 2, importe: 1901.96 },
      ],
      truncado: false,
      entrega: 'Bienes entregados: la entrega está validada en Odoo.',
      entregas: [{ folio: 'OFI/OUT/00650', estado: 'Hecha' }],
      // From the same product read (review PR #165): the mango has no SAT key, the service does.
      sin_clave_sat: [MANGO.name],
      borrador_existente: null,
    })
    // The yes writes; the summary never does.
    expect(result).not.toHaveProperty('factura')
  })

  test('el plan trae la huella de lo que lee: venta, total, facturas previas y líneas (#155 C4)', async () => {
    const { odoo } = fakeOdoo(readyScript())
    const { writer } = throwingWriter()
    const plan = await planDraftInvoice({ reader: odoo, writer }, context().ctx, INPUT)
    expect(plan).toMatchObject({
      sinCambios: false,
      subject: 'La venta S00912',
      nota: 'Nada se ha escrito. Muestra el resumen (cliente, total, líneas, entrega, sin clave SAT) y, tras el sí, repite con el mismo folio y la clave: quedará en BORRADOR, sin folio ni timbre.',
      fingerprint: { sale: 912, total: 2.32, invoices: [], ready: 'lista' },
    })
    // Another total or another set of invoices is another fingerprint: the key would not serve.
    const moved = fakeOdoo(readyScript({ 'sale.order.search_read': [[saleRow({ amount_total: 5 })]] }))
    const other = await planDraftInvoice({ reader: moved.odoo, writer }, context().ctx, INPUT)
    expect(other.fingerprint).not.toEqual(plan.fingerprint)
  })

  test('con borrador ya existente lo dice como sin_cambios, sin líneas por facturar ni escritura', async () => {
    const { odoo } = fakeOdoo(
      readyScript({
        'sale.order.search_read': [[saleRow({ invoice_ids: [1300] })]],
        'account.move.search_read': [[{ id: 1300, name: false, state: 'draft', move_type: 'out_invoice', amount_total: 2.32 }]],
      }),
    )
    const { writer, attempts } = throwingWriter()
    const plan = await planDraftInvoice({ reader: odoo, writer }, context().ctx, INPUT)
    expect(plan.entity.value).toMatchObject({
      a_facturar: null,
      lineas: [],
      borrador_existente: { id: 1300, total: 2.32, moneda: 'MXN' },
      entrega: 'Solo servicios: no lleva entrega.',
    })
    expect(plan).toMatchObject({ sinCambios: true, nota: ALREADY_NOTE })
    expect(attempts).toEqual([])
  })

  test('bienes por pedido sin entregar: el resumen avisa que van en la factura', async () => {
    const byOrder = { ...MANGO, invoice_policy: 'order', unspsc_code_id: [70, '27111700 Llaves'] }
    const { odoo } = fakeOdoo(
      readyScript({
        'sale.order.search_read': [[saleRow({ picking_ids: [650] })]],
        'sale.order.line.search_read': [[{ ...MANGO_LINE, qty_to_invoice: 2 }]],
        'product.product.search_read': [[byOrder]],
        'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'assigned' }]],
      }),
    )
    const { writer, attempts } = throwingWriter()
    const result = await summaryOf({ reader: odoo, writer }, context().ctx)
    expect(result.entrega).toBe('1 de 1 bienes sin entregar se facturan por pedido: van en la factura aunque la entrega siga abierta.')
    expect(result.entregas).toEqual([{ folio: 'OFI/OUT/00650', estado: 'Lista' }])
    expect(attempts).toEqual([])
  })

  test(`más de ${SUMMARY_LINES_MAX} líneas: el resumen se trunca, el total no`, async () => {
    const many = Array.from({ length: SUMMARY_LINES_MAX + 3 }, (_, i) => lineRow({ id: 9000 + i, name: `Servicio ${i + 1}` }))
    const { odoo } = fakeOdoo(readyScript({ 'sale.order.line.search_read': [many] }))
    const { writer, attempts } = throwingWriter()
    const result = await summaryOf({ reader: odoo, writer }, context().ctx)
    expect(result.lineas).toHaveLength(SUMMARY_LINES_MAX)
    expect(result).toMatchObject({ truncado: true, a_facturar: { total: 2.32 } })
    expect(attempts).toEqual([])
  })
})

describe('borrador tras el sí (fase 2, #155 C4)', () => {
  test('ya tiene borrador → sin_cambios, sin aviso si lleva el rastro, y no crea otro', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // The real trail text, as the writer leaves it after creating a draft.
    const trailedNote = `${ORIGINAL_NOTE}${trailNote('Factura en borrador creada', 'Ana Admin', new Date(NOW))}`
    const { odoo, calls } = fakeOdoo(
      readyScript({
        'sale.order.search_read': [[saleRow({ invoice_ids: [1300], internal_note: trailedNote })]],
        'account.move.search_read': [[{ id: 1300, name: false, state: 'draft', move_type: 'out_invoice', amount_total: 2.32 }]],
      }),
    )
    const { writer, attempts } = throwingWriter()
    const plan = await planDraftInvoice({ reader: odoo, writer }, context().ctx, INPUT)
    expect(plan).toMatchObject({ sinCambios: true, nota: ALREADY_NOTE })
    expect(plan.avisos).toBeUndefined()
    expect(plan.entity.value).toMatchObject({ borrador_existente: { id: 1300, total: 2.32, moneda: 'MXN' } })
    expect(calls.find((c) => c.model === 'account.move')?.payload).toMatchObject({ domain: [['id', 'in', [1300]]] })
    expect(attempts).toEqual([])
    expect(error).not.toHaveBeenCalled()
  })

  test('un borrador sin el rastro del asistente sale con aviso, sin escribir', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    // A confirm trail is not an invoice trail; an empty note (false) has none either.
    for (const internal_note of [ORIGINAL_NOTE, false]) {
      const { odoo } = fakeOdoo(
        readyScript({
          'sale.order.search_read': [[saleRow({ invoice_ids: [1300], internal_note })]],
          'account.move.search_read': [[{ id: 1300, name: false, state: 'draft', move_type: 'out_invoice', amount_total: 2.32 }]],
        }),
      )
      const { writer, attempts } = throwingWriter()
      const plan = await planDraftInvoice({ reader: odoo, writer }, context().ctx, INPUT)
      expect(plan).toMatchObject({ sinCambios: true, avisos: [MISSING_TRAIL] })
      expect(attempts).toEqual([])
    }
    expect(error).toHaveBeenCalledWith('[odoo-write] draft invoice without the assistant trail', { saleId: 912 })
  })

  test('crea con delivered, deja rastro y verifica draft, out_invoice y auto_post no', async () => {
    const { odoo, calls } = fakeOdoo(readyScript())
    const { writer, calls: writes, logs } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })

    const result = await confirm({ reader: odoo, writer }, context().ctx)

    expect(writes.map((w) => `${w.model}.${w.method}`)).toEqual([
      'sale.advance.payment.inv.create',
      'sale.advance.payment.inv.create_invoices',
      'sale.order.write',
    ])
    expect(writes[0].payload).toEqual({
      vals_list: [{ advance_payment_method: 'delivered', sale_order_ids: [[6, 0, [912]]] }],
      context: WIZARD_CONTEXT,
    })
    // Without open_invoices: the new invoice is found by rereading the sale.
    expect(writes[1].payload).toEqual({ ids: [55], context: WIZARD_CONTEXT })
    expect(writes[2].payload).toEqual({
      ids: [912],
      vals: { internal_note: `${ORIGINAL_NOTE}<p>Factura en borrador creada por el asistente a petición de Ana Admin · ${STAMP}</p>` },
    })
    expect(logs.map((l) => l.op)).toEqual([
      'sale.advance.payment.inv.create',
      'sale.advance.payment.inv.create_invoices',
      'sale.order.write',
    ])

    expect(calls.map((c) => `${c.model}.${c.method}`)).toEqual([
      'sale.order.search_read',
      'sale.order.line.search_read',
      'product.product.search_read',
      'sale.order.search_read',
      'account.move.search_read',
    ])
    expect(calls[3].payload).toEqual({ domain: [['id', '=', 912]], fields: ['invoice_ids'], limit: 1 })
    expect(calls[4].payload).toMatchObject({
      domain: [['id', '=', 1300]],
      fields: expect.arrayContaining(['state', 'move_type', 'name', 'auto_post', 'is_move_sent', 'sending_data', 'l10n_mx_edi_cfdi_state']),
    })
    expect(result).toEqual({
      venta: { folio: 'S00912', id: 912, cliente: COMPANY_NAME },
      factura: { id: 1300, folio: '(borrador, sin folio)', estado: 'borrador', total: 2.32, moneda: 'MXN' },
      sin_clave_sat: [],
      recordatorio: 'Quedó en BORRADOR. Revisarla, publicarla y timbrarla se hace en Odoo; el asistente nunca timbra.',
    })
  })

  test('avisa de los productos sin clave SAT', async () => {
    const delivered = { ...MANGO_LINE, qty_delivered: 2, qty_to_invoice: 2 }
    const { odoo } = fakeOdoo(
      readyScript({
        'sale.order.search_read': [[saleRow({ picking_ids: [650] })], [{ id: 912, invoice_ids: [1300] }]],
        'sale.order.line.search_read': [[lineRow(), delivered]],
        'product.product.search_read': [[REPINTADO, MANGO]],
        'stock.picking.search_read': [[{ id: 650, name: 'OFI/OUT/00650', state: 'done' }]],
      }),
    )
    const { writer } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })
    const result = await confirm({ reader: odoo, writer }, context().ctx)
    expect(result.sin_clave_sat).toEqual([MANGO.name])
  })

  test('si Odoo la devolviera publicada o con auto_post → ALERTA', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const alerta = 'ALERTA: la factura 1300 no quedó como borrador manual; revísala en Odoo de inmediato.'
    const cases: [string, Record<string, unknown>, string[]][] = [
      ['publicada', { state: 'posted', name: 'F00610' }, ['state', 'name']],
      ['auto_post', { auto_post: 'at_date' }, ['auto_post']],
      ['enviada', { is_move_sent: true, sending_data: { mail: true } }, ['is_move_sent', 'sending_data']],
      ['timbrada', { l10n_mx_edi_cfdi_state: 'sent' }, ['l10n_mx_edi_cfdi_state']],
      ['nota de crédito', { move_type: 'out_refund' }, ['move_type']],
    ]
    for (const [label, overrides, fields] of cases) {
      const { odoo } = fakeOdoo(readyScript({ 'account.move.search_read': [[invoiceRow(overrides)]] }))
      const { writer } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })
      await expect(confirm({ reader: odoo, writer }, context().ctx), label).rejects.toThrow(alerta)
      expect(error, label).toHaveBeenLastCalledWith('[odoo-write] draft invoice failed verification', { saleId: 912, invoiceId: 1300, fields })
    }

    // Not exactly one new invoice: an alert as well.
    for (const ids of [[], [1300, 1301]]) {
      const { odoo } = fakeOdoo(readyScript({ 'sale.order.search_read': [[saleRow()], [{ id: 912, invoice_ids: ids }]] }))
      const { writer } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })
      await expect(confirm({ reader: odoo, writer }, context().ctx)).rejects.toThrow(/^ALERTA: /)
    }
  })

  test('si no puedo releerla, no finge que quedó bien', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { odoo } = fakeOdoo(readyScript({ 'account.move.search_read': [new Error('red caída')] }))
    const { writer } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })
    await expect(confirm({ reader: odoo, writer }, context().ctx)).rejects.toThrow(
      /^Odoo creó la factura en borrador de la S00912, pero no pude releerla para comprobar que sigue en borrador/,
    )
    expect(error).toHaveBeenCalledWith('[odoo-write] draft invoice could not be verified', { saleId: 912, error: 'Error' })
  })

  test('si el rastro falla, la factura queda y sale aviso', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { odoo } = fakeOdoo(readyScript())
    const { writer, calls } = fakeWriter({
      'sale.advance.payment.inv.create': [[55]],
      'sale.order.write': [new OdooUncertainWriteError('sale.order.write', 'quotation', 504)],
    })
    const result = await confirm({ reader: odoo, writer }, context().ctx)
    expect(calls.map((c) => c.method)).toEqual(['create', 'create_invoices', 'write'])
    expect(result.aviso_rastro).toBe(
      'La factura en borrador de la S00912 se creó, pero no pude anotar en la nota interna de la venta quién la pidió.',
    )
    expect(result.factura).toMatchObject({ id: 1300, estado: 'borrador' })
    expect(error).toHaveBeenCalledWith('[odoo-write] trail failed after the draft invoice', { saleId: 912, error: 'OdooUncertainWriteError' })
  })

  test('timeout al facturar → resultado desconocido; repetir la llamada reporta el borrador', async () => {
    const { writer, calls } = fakeWriter({
      'sale.advance.payment.inv.create': [[55]],
      'sale.advance.payment.inv.create_invoices': [new OdooUncertainWriteError('sale.advance.payment.inv.create_invoices', 'invoice', 504)],
    })
    const failure = await confirm({ reader: fakeOdoo(readyScript()).odoo, writer }, context().ctx).catch(
      (e: unknown) => e,
    )
    expect(failure).toBeInstanceOf(OdooUncertainWriteError)
    expect((failure as Error).message).toMatch(/Pide otra vez el resumen con el mismo folio: si el borrador ya se creó, te lo reporto/)
    // No trail after an unknown outcome.
    expect(calls.map((c) => c.method)).toEqual(['create', 'create_invoices'])

    const { odoo } = fakeOdoo(
      readyScript({
        'sale.order.search_read': [[saleRow({ invoice_ids: [1300] })]],
        'account.move.search_read': [[{ id: 1300, name: false, state: 'draft', move_type: 'out_invoice', amount_total: 2.32 }]],
      }),
    )
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const { writer: never, attempts } = throwingWriter()
    // Its trail never ran: the new summary says who-asked is missing instead of a silent "ya existía".
    const retry = await planDraftInvoice({ reader: odoo, writer: never }, context().ctx, INPUT)
    expect(retry).toMatchObject({ sinCambios: true, avisos: [MISSING_TRAIL] })
    expect(attempts).toEqual([])
    expect(error).toHaveBeenCalledWith('[odoo-write] draft invoice without the assistant trail', { saleId: 912 })
  })

  test('account.move solo se lee', async () => {
    const { odoo, calls } = fakeOdoo(readyScript())
    const { writer, calls: writes } = fakeWriter({ 'sale.advance.payment.inv.create': [[55]] })
    await confirm({ reader: odoo, writer }, context().ctx)
    // The invoice comes from the sale's wizard; the assistant never writes an account.* model.
    expect(writes.map((w) => w.model)).toEqual(['sale.advance.payment.inv', 'sale.advance.payment.inv', 'sale.order'])
    expect(calls.filter((c) => c.model.startsWith('account.')).map((c) => `${c.model}.${c.method}`)).toEqual([
      'account.move.search_read',
    ])
  })
})
