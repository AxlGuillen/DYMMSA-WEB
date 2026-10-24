/**
 * odoo_create_draft_invoice (#144, ADR-040): the FULL invoice of a confirmed sale, as a draft only.
 * Without confirmar it only summarizes (#155 B2b); with it, the draft is created and reread to prove it stayed one.
 */

import { z } from 'zod'
import { OdooError, type OdooCaller } from '@/lib/odoo/client'
import { startDeadline } from '@/lib/odoo/deadline'
import { odooWriteEnv } from '@/lib/odoo/env'
import { idsOf, many2oneId } from '@/lib/odoo/normalize'
import {
  invoiceReadiness,
  PICKING_STATE_LABEL,
  type InvoiceReadiness,
  type OdooProduct,
  type ReadinessInvoice,
  type ReadinessLine,
  type ReadinessSale,
} from '@/lib/odoo/quotation-plan'
import { noteHasTrail } from '@/lib/odoo/writer'
import type { McpContext } from '../../core/context'
import { requireLiveAdmin } from '@/lib/mcp/core/auth/live-admin'
import { ToolError } from '@/lib/mcp/core/errors'
import { errorName, noteOf, parseInput, type OdooQuotationDeps } from './quotations'
import { isId, many2oneName, numberOr, requireExactSale, rowsOf, type SaleRecord } from './resolve'

type ToolContext = Pick<McpContext, 'db' | 'userId' | 'role'>

export const draftInvoiceShape = {
  folio: z.string().regex(/^S\d{5,}$/i, 'folio de venta de Odoo, ej. S00912').describe('Folio exacto de la venta confirmada'),
  confirmar: z.literal(true).optional().describe('Crea el borrador; sin esto solo muestra el resumen'),
}

const draftInvoiceSchema = z.strictObject(draftInvoiceShape)

export type DraftInvoiceInput = z.infer<typeof draftInvoiceSchema>

export interface DraftInvoiceView {
  readonly id: number
  readonly folio: string
  readonly estado: 'borrador'
  readonly total: number | null
  readonly moneda: string | null
}

type SaleRef = { readonly folio: string; readonly id: number; readonly cliente: string | null }

/** odoo_create_draft_invoice's result: always a draft, never posted nor stamped. */
export interface DraftInvoiceResult {
  readonly venta: SaleRef
  readonly factura: DraftInvoiceView
  readonly ya_existia?: true
  /** Products on the invoice without a SAT key: add it in Odoo before stamping. */
  readonly sin_clave_sat: readonly string[]
  readonly aviso_rastro?: string
  readonly recordatorio: string
}

export interface InvoiceSummaryLine {
  readonly producto: string
  readonly cantidad: number
  /** Sin IVA, in the sale's currency. */
  readonly importe: number
}

/** Without confirmar (#155 B2b): what the draft would carry, so the admin's yes means something. Nothing written. */
export interface DraftInvoiceSummary {
  readonly venta: SaleRef
  /** The whole sale (the assistant only invoices complete ones), never converted; null if a draft exists. */
  readonly a_facturar: { readonly subtotal: number; readonly total: number; readonly moneda: string | null } | null
  readonly lineas: readonly InvoiceSummaryLine[]
  readonly truncado: boolean
  readonly entrega: string
  readonly entregas: readonly { readonly folio: string; readonly estado: string }[]
  readonly borrador_existente: { readonly id: number; readonly total: number; readonly moneda: string | null } | null
  readonly siguiente_paso: string
}

const SALE_FIELDS = [
  'partner_id', 'invoice_status', 'amount_untaxed', 'amount_total', 'currency_id', 'invoice_ids', 'picking_ids', 'internal_note',
]
const LINE_FIELDS = [
  'name', 'display_type', 'product_id', 'is_downpayment', 'product_uom_qty', 'qty_delivered', 'qty_invoiced', 'qty_to_invoice', 'price_unit',
  'price_subtotal',
]
const INVOICE_FIELDS = ['name', 'state', 'move_type', 'amount_total']
// What a manual draft looks like (verified on draft 1208): no folio, no auto-post, never sent nor stamped.
const VERIFY_FIELDS = [...INVOICE_FIELDS, 'auto_post', 'is_move_sent', 'sending_data', 'l10n_mx_edi_cfdi_state', 'currency_id']

/** Readiness needs EVERY line: past this the sale is invoiced in Odoo, never from a cut-off read. */
export const MAX_INVOICE_LINES = 200

const NO_FOLIO = '(borrador, sin folio)'
const REMINDER = 'Quedó en BORRADOR. Revisarla, publicarla y timbrarla se hace en Odoo; el asistente nunca timbra.'
// Neutral on who made it: an uncertain create_invoices of this assistant may be the one that landed.
const ALREADY_REMINDER =
  'La venta ya tiene una factura en borrador: no creé otra. Revisarla, publicarla y timbrarla se hace en Odoo; el asistente nunca timbra.'

const missingInvoiceTrail = (name: string) =>
  `La nota interna de la ${name} no dice que el asistente creó este borrador: si fue un intento anterior que quedó incierto, anota en Odoo quién lo pidió.`

function readinessSale(sale: SaleRecord): ReadinessSale {
  const status = sale.raw.invoice_status
  return {
    name: sale.name,
    state: sale.state,
    invoiceStatus: typeof status === 'string' ? status : null,
    amountTotal: numberOr(sale.raw.amount_total, 0),
  }
}

interface InvoiceLine extends ReadinessLine {
  readonly subtotal: number
}

async function readLines(reader: OdooCaller, sale: SaleRecord): Promise<InvoiceLine[]> {
  const rows = rowsOf(
    await reader('sale.order.line', 'search_read', {
      domain: [['order_id', '=', sale.id]],
      fields: LINE_FIELDS,
      order: 'sequence asc, id asc',
      limit: MAX_INVOICE_LINES + 1,
    }),
  )
  if (rows.length > MAX_INVOICE_LINES) {
    throw new ToolError(`La ${sale.name} tiene más de ${MAX_INVOICE_LINES} líneas: factúrala en Odoo.`)
  }
  return rows.map((row) => {
    const displayType = row.display_type === false ? false : typeof row.display_type === 'string' && row.display_type ? row.display_type : null
    if (displayType === null) throw new OdooError(`No pude leer las líneas de la ${sale.name}: no escribí nada.`)
    return {
      name: typeof row.name === 'string' ? row.name : '',
      displayType,
      productId: many2oneId(row.product_id),
      isDownpayment: row.is_downpayment === true,
      qty: numberOr(row.product_uom_qty, 0),
      qtyDelivered: numberOr(row.qty_delivered, 0),
      qtyInvoiced: numberOr(row.qty_invoiced, 0),
      qtyToInvoice: numberOr(row.qty_to_invoice, 0),
      price: numberOr(row.price_unit, 0),
      subtotal: numberOr(row.price_subtotal, 0),
    }
  })
}

type InvoiceProduct = Pick<OdooProduct, 'type' | 'invoicePolicy' | 'name' | 'satKey'>

async function readProducts(reader: OdooCaller, lines: readonly ReadinessLine[]): Promise<Map<number, InvoiceProduct>> {
  const ids = [...new Set(lines.flatMap((line) => (line.productId !== null ? [line.productId] : [])))].sort((a, b) => a - b)
  if (ids.length === 0) return new Map()
  const rows = rowsOf(
    await reader('product.product', 'search_read', {
      domain: [['id', 'in', ids]],
      fields: ['name', 'type', 'invoice_policy', 'unspsc_code_id'],
      limit: ids.length,
      // A line keeps its product even after it is archived.
      context: { active_test: false },
    }),
  )
  return new Map(
    rows.flatMap((row): [number, InvoiceProduct][] =>
      isId(row.id) && typeof row.type === 'string'
        ? [[row.id, {
            name: typeof row.name === 'string' ? row.name : `#${row.id}`,
            type: row.type,
            invoicePolicy: typeof row.invoice_policy === 'string' ? row.invoice_policy : null,
            satKey: many2oneName(row.unspsc_code_id),
          }]]
        : [],
    ),
  )
}

async function readInvoices(reader: OdooCaller, ids: readonly number[]): Promise<ReadinessInvoice[]> {
  if (ids.length === 0) return []
  const rows = rowsOf(
    await reader('account.move', 'search_read', { domain: [['id', 'in', [...ids]]], fields: INVOICE_FIELDS, limit: ids.length }),
  )
  return rows.map((row) => {
    if (!isId(row.id) || typeof row.state !== 'string' || typeof row.move_type !== 'string') {
      throw new OdooError('Odoo devolvió una factura que no pude leer: no escribí nada.')
    }
    return {
      id: row.id,
      name: typeof row.name === 'string' && row.name ? row.name : false,
      state: row.state,
      moveType: row.move_type,
      amountTotal: numberOr(row.amount_total, 0),
    }
  })
}

async function readPickings(reader: OdooCaller, ids: readonly number[]): Promise<{ name: string; state: string }[]> {
  if (ids.length === 0) return []
  const rows = rowsOf(
    await reader('stock.picking', 'search_read', { domain: [['id', 'in', [...ids]]], fields: ['name', 'state'], limit: ids.length, order: 'id asc' }),
  )
  return rows.flatMap((row) => (typeof row.name === 'string' && typeof row.state === 'string' ? [{ name: row.name, state: row.state }] : []))
}

function withoutSatKey(lines: readonly ReadinessLine[], products: ReadonlyMap<number, InvoiceProduct>): string[] {
  const names = new Set<string>()
  for (const line of lines) {
    if (line.displayType !== false || line.productId === null) continue
    const product = products.get(line.productId)
    if (!product?.satKey) names.add(product?.name ?? line.name)
  }
  return [...names]
}

const isEmpty = (value: unknown) => value === false || value === null

/** Each one a field that, set, could post, send or stamp the invoice behind the admin's back. */
const DRAFT_CHECKS: readonly [field: string, ok: (value: unknown) => boolean][] = [
  ['state', (v) => v === 'draft'],
  ['move_type', (v) => v === 'out_invoice'],
  ['name', isEmpty],
  ['auto_post', (v) => v === 'no'],
  ['is_move_sent', (v) => v === false],
  ['sending_data', isEmpty],
  ['l10n_mx_edi_cfdi_state', isEmpty],
]

const notDraftAlert = (invoiceId: number) =>
  `ALERTA: la factura ${invoiceId} no quedó como borrador manual; revísala en Odoo de inmediato.`

/** invoice_ids before vs after: exactly one new invoice, and it must look like a manual draft. */
async function verifyNewDraft(reader: OdooCaller, sale: SaleRecord, before: readonly number[]): Promise<DraftInvoiceView> {
  let fresh: number[] = []
  let row: Record<string, unknown> | null = null
  try {
    const sales = rowsOf(await reader('sale.order', 'search_read', { domain: [['id', '=', sale.id]], fields: ['invoice_ids'], limit: 1 }))
    fresh = idsOf(sales[0]?.invoice_ids).filter((id) => !before.includes(id))
    if (fresh.length === 1) {
      const rows = rowsOf(await reader('account.move', 'search_read', { domain: [['id', '=', fresh[0]]], fields: VERIFY_FIELDS, limit: 1 }))
      row = rows[0] ?? null
    }
  } catch (error) {
    console.error('[odoo-write] draft invoice could not be verified', { saleId: sale.id, error: errorName(error) })
    throw new ToolError(
      `Odoo creó la factura en borrador de la ${sale.name}, pero no pude releerla para comprobar que sigue en borrador: revísala en Odoo de inmediato. Si repites la llamada, te reporto el borrador sin crear otro.`,
    )
  }

  if (fresh.length !== 1) {
    console.error('[odoo-write] draft invoice count mismatch', { saleId: sale.id, created: fresh })
    throw new ToolError(
      fresh.length === 0
        ? `ALERTA: Odoo respondió sin error, pero la ${sale.name} no muestra una factura nueva; revisa en Odoo de inmediato qué se creó.`
        : `ALERTA: Odoo creó ${fresh.length} facturas para la ${sale.name} (ids ${fresh.join(', ')}); revísalas en Odoo de inmediato.`,
    )
  }
  const invoiceId = fresh[0]
  // An unreadable row fails every check: unverified counts as not a draft.
  const failed = DRAFT_CHECKS.filter(([field, ok]) => !row || row.id !== invoiceId || !(field in row) || !ok(row[field])).map(
    ([field]) => field,
  )
  if (!row || failed.length > 0) {
    console.error('[odoo-write] draft invoice failed verification', { saleId: sale.id, invoiceId, fields: failed })
    throw new ToolError(notDraftAlert(invoiceId))
  }
  return { id: invoiceId, folio: NO_FOLIO, estado: 'borrador', total: numberOr(row.amount_total, 0), moneda: many2oneName(row.currency_id) }
}

/** Summary lines shown before the yes; the draft itself always carries every line. */
export const SUMMARY_LINES_MAX = 50

const QTY_EPSILON = 1e-6

const isGood = (line: InvoiceLine, products: ReadonlyMap<number, InvoiceProduct>) =>
  line.displayType === false && !(line.productId !== null && products.get(line.productId)?.type === 'service')

/** Goods invoiced "by order" pass readiness undelivered: the summary says so before the yes. */
function deliveryText(lines: readonly InvoiceLine[], products: ReadonlyMap<number, InvoiceProduct>): string {
  const goods = lines.filter((line) => isGood(line, products))
  if (goods.length === 0) return 'Solo servicios: no lleva entrega.'
  const undelivered = goods.filter((line) => line.qtyDelivered + QTY_EPSILON < line.qty).length
  if (undelivered === 0) return 'Bienes entregados: la entrega está validada en Odoo.'
  return `${undelivered} de ${goods.length} bienes sin entregar se facturan por pedido: van en la factura aunque la entrega siga abierta.`
}

const SUMMARY_NEXT_STEP =
  'Nada se ha escrito. Muestra el resumen (cliente, total, líneas, entrega) y, tras el sí, repite con el mismo folio y confirmar: true: quedará en BORRADOR, sin folio ni timbre.'
const SUMMARY_ALREADY =
  'Nada que crear: la venta ya tiene una factura en borrador. Revisarla, publicarla y timbrarla se hace en Odoo; el asistente nunca timbra.'

interface InvoiceState {
  readonly sale: SaleRecord
  readonly venta: SaleRef
  readonly before: readonly number[]
  readonly lines: readonly InvoiceLine[]
  readonly products: ReadonlyMap<number, InvoiceProduct>
  readonly pickings: readonly { name: string; state: string }[]
  readonly ready: Exclude<InvoiceReadiness, { estado: 'bloqueada' }>
}

/** Both phases read the same preconditions; a blocked sale is an error in either. */
async function readInvoiceState(reader: OdooCaller, folio: string): Promise<InvoiceState> {
  const sale = await requireExactSale(reader, folio, SALE_FIELDS)
  const readiness = readinessSale(sale)
  // A quotation or a cancelled sale is refused before reading anything else.
  if (sale.state !== 'sale') {
    const early = invoiceReadiness(readiness, [], new Map(), [])
    throw new ToolError(early.estado === 'bloqueada' ? early.motivo : `La ${sale.name} no es una venta confirmada.`)
  }

  const before = idsOf(sale.raw.invoice_ids)
  const invoices = await readInvoices(reader, before)
  const lines = await readLines(reader, sale)
  const products = await readProducts(reader, lines)
  const pickings = await readPickings(reader, idsOf(sale.raw.picking_ids))
  const ready = invoiceReadiness(readiness, lines, products, pickings, invoices)
  if (ready.estado === 'bloqueada') throw new ToolError(ready.motivo)
  return { sale, venta: { folio: sale.name, id: sale.id, cliente: sale.partnerName }, before, lines, products, pickings, ready }
}

function invoiceSummary(state: InvoiceState): DraftInvoiceSummary {
  const { sale, ready } = state
  const moneda = many2oneName(sale.raw.currency_id)
  const invoiceable = ready.estado === 'lista' ? state.lines.filter((l) => l.displayType === false && l.qtyToInvoice > QTY_EPSILON) : []
  return {
    venta: state.venta,
    a_facturar:
      ready.estado === 'lista'
        ? { subtotal: numberOr(sale.raw.amount_untaxed, 0), total: numberOr(sale.raw.amount_total, 0), moneda }
        : null,
    lineas: invoiceable.slice(0, SUMMARY_LINES_MAX).map((line) => ({
      producto: line.name || (line.productId !== null ? state.products.get(line.productId)?.name : undefined) || '(sin nombre)',
      cantidad: line.qtyToInvoice,
      importe: line.subtotal,
    })),
    truncado: invoiceable.length > SUMMARY_LINES_MAX,
    entrega: deliveryText(state.lines, state.products),
    entregas: state.pickings.map((p) => ({ folio: p.name, estado: PICKING_STATE_LABEL[p.state] ?? p.state })),
    borrador_existente: ready.estado === 'ya_existe' ? { id: ready.factura.id, total: ready.factura.total, moneda } : null,
    siguiente_paso: ready.estado === 'ya_existe' ? SUMMARY_ALREADY : SUMMARY_NEXT_STEP,
  }
}

/**
 * Both phases read every precondition; only confirmar: true creates the draft through the sale's
 * wizard and rereads it. Posting, stamping and sending stay in Odoo, always.
 */
export function odooCreateDraftInvoice(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: DraftInvoiceInput & { confirmar: true },
): Promise<DraftInvoiceResult>
export function odooCreateDraftInvoice(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: DraftInvoiceInput,
): Promise<DraftInvoiceResult | DraftInvoiceSummary>
export async function odooCreateDraftInvoice(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: DraftInvoiceInput,
): Promise<DraftInvoiceResult | DraftInvoiceSummary> {
  // First: the live-admin read counts against the request's budget (#144).
  const dl = startDeadline()
  const proof = await requireLiveAdmin(ctx)
  const input = parseInput(draftInvoiceSchema, raw)
  // Throws the precise reason (no key, bad URL) before anything is read.
  odooWriteEnv()

  const state = await readInvoiceState(deps.reader, input.folio)
  if (!input.confirmar) return invoiceSummary(state)
  const { sale, venta, before, ready } = state
  const sinClaveSat = withoutSatKey(state.lines, state.products)
  if (ready.estado === 'ya_existe') {
    // An uncertain create_invoices never reached its trail: say so instead of a silent "ya existía".
    const current = sale.raw.internal_note
    const trailed = noteHasTrail(typeof current === 'string' ? current : false, 'Factura en borrador creada')
    if (!trailed) console.error('[odoo-write] draft invoice without the assistant trail', { saleId: sale.id })
    return {
      venta,
      factura: { id: ready.factura.id, folio: NO_FOLIO, estado: 'borrador', total: ready.factura.total, moneda: many2oneName(sale.raw.currency_id) },
      ya_existia: true,
      sin_clave_sat: sinClaveSat,
      ...(trailed ? {} : { aviso_rastro: missingInvoiceTrail(sale.name) }),
      recordatorio: ALREADY_REMINDER,
    }
  }

  const note = noteOf(sale)
  await deps.writer.createDraftInvoice(proof, sale.id, dl)
  let avisoRastro: string | undefined
  try {
    await deps.writer.appendSaleTrail(proof, sale.id, note, 'Factura en borrador creada', dl)
  } catch (error) {
    // The draft exists either way: a missing trail line is reported, not undone.
    console.error('[odoo-write] trail failed after the draft invoice', { saleId: sale.id, error: errorName(error) })
    avisoRastro = `La factura en borrador de la ${sale.name} se creó, pero no pude anotar en la nota interna de la venta quién la pidió.`
  }

  const factura = await verifyNewDraft(deps.reader, sale, before)
  return {
    venta,
    factura,
    sin_clave_sat: sinClaveSat,
    ...(avisoRastro ? { aviso_rastro: avisoRastro } : {}),
    recordatorio: REMINDER,
  }
}
