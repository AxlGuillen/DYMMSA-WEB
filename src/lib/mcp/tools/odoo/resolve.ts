/** Lookups of the Odoo write tools (#144, ADR-040): fixed projections, one search per kind, never a guess. */

import { OdooError, type OdooCaller } from '@/lib/odoo/client'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { escapeLike, orDomain, type DomainItem } from '@/lib/odoo/domains'
import { many2oneId } from '@/lib/odoo/normalize'
import {
  COMPANY_PARTNER_ID,
  isProductLine,
  lineKindOf,
  matchProducts,
  productSearchConditions,
  splitEtm,
  type CurrentLine,
  type LineRequest,
  type OdooProduct,
  type ProductMatch,
} from '@/lib/odoo/quotation-plan'
import { fold, requireSingleMatch, ToolError } from '../../shared'

type Row = Record<string, unknown>

/** Strict on purpose: an odd answer read as "no rows" would turn every product into a new one. */
export function rowsOf(value: unknown): Row[] {
  if (!Array.isArray(value) || !value.every((r) => typeof r === 'object' && r !== null && !Array.isArray(r))) {
    throw new OdooError('Odoo devolvió una respuesta que no pude leer: no seguí para no adivinar.')
  }
  return value as Row[]
}

const isId = (value: unknown): value is number => typeof value === 'number' && Number.isInteger(value) && value > 0
const text = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null)
export const numberOr = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)

/** many2one [id, name] → the name. */
export const many2oneName = (value: unknown): string | null =>
  Array.isArray(value) && typeof value[1] === 'string' ? value[1] : null

export interface WritePartner {
  readonly id: number
  readonly name: string
  readonly vat: string | null
  /** The company's own contact (res.partner 1). */
  readonly isCompany: boolean
}

const PARTNER_FIELDS = ['name', 'vat', 'active']
const PARTNER_LIMIT = 6
// Persona moral (3 letters) or física (4), date, homoclave.
const RFC = /^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/

function partnerDomain(query: string): DomainItem[] {
  const byId = /^#(\d+)$/.exec(query)
  if (byId) return [['id', '=', Number(byId[1])]]
  const upper = query.toUpperCase()
  // Odoo copies vat to every child contact and address: an RFC names the commercial entity only.
  if (RFC.test(upper)) return [['vat', '=', upper], '|', ['is_company', '=', true], ['parent_id', '=', false]]
  return [['name', 'ilike', escapeLike(query)]]
}

/** Nameless rows are addresses (invoice, delivery), never the customer to quote. */
function parsePartners(value: unknown): WritePartner[] {
  return rowsOf(value).flatMap((row) => {
    if (!isId(row.id)) throw new OdooError('Odoo devolvió un cliente que no pude leer.')
    const name = text(row.name)
    return name ? [{ id: row.id, name, vat: text(row.vat), isCompany: row.id === COMPANY_PARTNER_ID }] : []
  })
}

const partnerLabel = (p: WritePartner) => `${p.name} (#${p.id})`

/** Name, RFC or '#id'; no customer_rank filter: quote-only customers and the company itself have 0. */
export async function resolvePartnerForWrite(odoo: OdooCaller, query: string): Promise<WritePartner> {
  const q = query.trim()
  if (!q) throw new ToolError('Indica el cliente: nombre, RFC o #id.')
  const domain = partnerDomain(q)
  const found = parsePartners(
    await odoo('res.partner', 'search_read', { domain, fields: PARTNER_FIELDS, limit: PARTNER_LIMIT, order: 'name asc' }),
  )
  if (found.length === 0) {
    const archived = parsePartners(
      await odoo('res.partner', 'search_read', {
        domain,
        fields: PARTNER_FIELDS,
        limit: PARTNER_LIMIT,
        order: 'name asc',
        context: { active_test: false },
      }),
    )
    if (archived.length > 0) {
      throw new ToolError(
        `El cliente ${archived.slice(0, 3).map(partnerLabel).join(', ')} está archivado en Odoo: reactívalo ahí y vuelve a pedirlo. El asistente no da de alta ni reactiva clientes.`,
      )
    }
    throw new ToolError(
      `No hay ningún cliente en Odoo que coincida con "${q}": créalo en Odoo (el asistente no da de alta clientes) y vuelve a pedirlo.`,
    )
  }
  const exact = found.filter((p) => fold(p.name) === fold(q))
  return requireSingleMatch(exact.length > 0 ? exact : found, partnerLabel, 'cliente en Odoo', q)
}

const PRODUCT_FIELDS = [
  'name', 'default_code', 'type', 'is_storable', 'invoice_policy', 'sale_ok', 'active', 'list_price', 'uom_id', 'unspsc_code_id',
]

function parseProducts(value: unknown): OdooProduct[] {
  return rowsOf(value).map((row) => {
    if (!isId(row.id) || typeof row.name !== 'string' || typeof row.type !== 'string') {
      throw new OdooError('Odoo devolvió un producto que no pude leer: no seguí para no adivinar.')
    }
    return {
      id: row.id,
      name: row.name,
      etm: splitEtm(typeof row.default_code === 'string' ? row.default_code : null),
      type: row.type,
      invoicePolicy: text(row.invoice_policy),
      saleOk: row.sale_ok === true,
      active: row.active !== false,
      uom: many2oneName(row.uom_id),
      satKey: many2oneName(row.unspsc_code_id),
    }
  })
}

export interface ResolvedProducts {
  /** Aligned with the lines: null for notes and sections. */
  readonly matches: (ProductMatch | null)[]
  readonly products: ReadonlyMap<number, OdooProduct>
}

/** ONE product.product search for every line (archived included), then the precedence in memory. */
export async function resolveProductsForWrite(
  odoo: OdooCaller,
  lines: readonly LineRequest[],
  opts: { lineProducts?: ReadonlyMap<number, number | null> } = {},
): Promise<ResolvedProducts> {
  const productLines = lines.filter(isProductLine)
  const ids = new Set<number>()
  for (const id of opts.lineProducts?.values() ?? []) if (id !== null) ids.add(id)
  for (const line of productLines) if (line.producto_id !== undefined) ids.add(line.producto_id)

  const seen = new Set<string>()
  const conditions: DomainTriple[] = ids.size > 0 ? [['id', 'in', [...ids].sort((a, b) => a - b)]] : []
  for (const condition of productLines.flatMap(productSearchConditions)) {
    const key = JSON.stringify(condition)
    if (!seen.has(key)) {
      seen.add(key)
      conditions.push(condition)
    }
  }
  if (conditions.length === 0) {
    return { matches: matchProducts(lines, [], { lineProducts: opts.lineProducts }), products: new Map() }
  }

  const limit = Math.min(Math.max(productLines.length, ids.size) * 6 + 50, 400)
  const rows = parseProducts(
    await odoo('product.product', 'search_read', {
      domain: orDomain(conditions),
      fields: PRODUCT_FIELDS,
      limit,
      order: 'id asc',
      context: { active_test: false },
    }),
  )
  const truncated = rows.length >= limit
  return {
    matches: matchProducts(lines, rows, { lineProducts: opts.lineProducts, truncated }),
    products: new Map(rows.map((p) => [p.id, p])),
  }
}

/** A sale.order as the quotation tools read it. */
export interface SaleRecord {
  readonly id: number
  readonly name: string
  readonly state: string
  readonly locked: boolean
  /** The edit lock: the preview signs it, the save compares it. */
  readonly writeDate: string | null
  readonly partnerId: number | null
  readonly partnerName: string | null
  readonly validityDate: string | null
  readonly raw: Row
}

export function saleFromRow(row: Row): SaleRecord {
  if (!isId(row.id) || typeof row.name !== 'string' || typeof row.state !== 'string') {
    throw new OdooError('Odoo devolvió una venta que no pude leer.')
  }
  return {
    id: row.id,
    name: row.name,
    state: row.state,
    locked: row.locked === true,
    writeDate: text(row.write_date),
    partnerId: many2oneId(row.partner_id),
    partnerName: many2oneName(row.partner_id),
    validityDate: text(row.validity_date),
    raw: row,
  }
}

const FOLIO_SUGGESTIONS = 3

/** The exact folio or an error; a near folio is only suggested, never used. */
export async function requireExactSale(odoo: OdooCaller, folio: string, fields: readonly string[]): Promise<SaleRecord> {
  const name = folio.trim().toUpperCase()
  if (!name) throw new ToolError('Indica el folio de la venta (p. ej. S00912).')
  const projection = [...new Set(['name', 'state', ...fields])]
  const rows = rowsOf(await odoo('sale.order', 'search_read', { domain: [['name', '=', name]], fields: projection, limit: 2 }))
  if (rows.length === 1) return saleFromRow(rows[0])
  if (rows.length > 1) throw new ToolError(`Hay más de una venta con el folio ${name} en Odoo: revísalo ahí.`)

  const digits = name.replace(/^S0*/, '')
  const near = /^\d+$/.test(digits)
    ? rowsOf(
        await odoo('sale.order', 'search_read', {
          domain: [['name', '=ilike', `S%${escapeLike(digits)}`]],
          fields: ['name'],
          limit: FOLIO_SUGGESTIONS,
          order: 'name asc',
        }),
      )
        .map((row) => row.name)
        .filter((n): n is string => typeof n === 'string')
    : []
  const hint = near.length ? ` ¿Quisiste decir ${near.join(' o ')}? Pásame el folio completo.` : ''
  throw new ToolError(`No hay ninguna venta ${name} en Odoo.${hint}`)
}

/** More than this and an edit could exceed the writer's 200 commands (80 desired + every removal). */
export const MAX_EDIT_LINES = 120

const LINE_FIELDS = ['display_type', 'name', 'product_id', 'product_uom_qty', 'price_unit', 'discount', 'sequence', 'price_subtotal']

export async function readSaleLines(odoo: OdooCaller, sale: Pick<SaleRecord, 'id' | 'name'>): Promise<CurrentLine[]> {
  const rows = rowsOf(
    await odoo('sale.order.line', 'search_read', {
      domain: [['order_id', '=', sale.id]],
      fields: LINE_FIELDS,
      order: 'sequence asc, id asc',
      limit: MAX_EDIT_LINES + 1,
    }),
  )
  if (rows.length > MAX_EDIT_LINES) {
    throw new ToolError(`La ${sale.name} tiene más de ${MAX_EDIT_LINES} líneas: edítala en Odoo.`)
  }
  return rows.map((row) => {
    const displayType = row.display_type === false ? false : text(row.display_type)
    if (!isId(row.id) || displayType === null) throw new OdooError('No pude leer las líneas de la cotización: no seguí.')
    return {
      id: row.id,
      kind: lineKindOf(displayType),
      displayType,
      name: typeof row.name === 'string' ? row.name : '',
      productId: many2oneId(row.product_id),
      qty: numberOr(row.product_uom_qty, 0),
      price: numberOr(row.price_unit, 0),
      discount: numberOr(row.discount, 0),
      sequence: numberOr(row.sequence, 0),
      subtotal: typeof row.price_subtotal === 'number' ? row.price_subtotal : null,
    }
  })
}
