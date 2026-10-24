/**
 * Pure planning for the Odoo quotation tools (#144, ADR-040): mode, product matching, the line
 * diff of an edit, what confirming does and whether a sale can be invoiced. No Odoo calls here.
 */

import { fold } from '@/lib/text'
import type { DomainTriple } from './catalog'
import { OdooError } from './client'
import { escapeLike } from './domains'
import { ETM_CODE_LIST, PRODUCT_NAME_MAX, type SaleLineCommand, type SaleLineUpdate, type SaleLineVals } from './write-catalog'

/** A requested line after zod (quotationLine in src/lib/mcp/tools/odoo/quotations.ts). */
export interface LineRequest {
  readonly linea_id?: number
  readonly producto_id?: number
  readonly codigo?: string
  readonly etm?: string
  readonly marca?: string
  readonly descripcion?: string
  readonly clave_sat?: string
  readonly cantidad?: number
  readonly precio?: number
  readonly descuento?: number
  readonly nota?: string
  readonly seccion?: string
}

export type LineKind = 'producto' | 'nota' | 'seccion'
/** Confirming is not a mode: odoo_confirm_quotation takes only the folio and the review key (#155 B2b). */
export type QuotationMode = 'crear' | 'editar' | 'revisar'

export interface ModeInput {
  readonly cliente?: string
  readonly folio?: string
  readonly lineas?: readonly LineRequest[]
  readonly vigencia?: string
}

const VALIDITY_NEEDS_LINES =
  'La vigencia se cambia editando: manda el folio, la vigencia y las líneas (parte de lineas_como_entrada).'

/** Odoo's company partner: quoting it is allowed, but the preview says so. */
export const COMPANY_PARTNER_ID = 1

/** At most this many products created in one go (product.product.create in the write catalog). */
export const MAX_NEW_PRODUCTS = 40

const EPSILON = 1e-6
const same = (a: number, b: number) => Math.abs(a - b) < EPSILON
const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100
const present = (value: string | undefined): value is string => value !== undefined && value.trim() !== ''
const clean = (value: string) => value.trim().replace(/\s+/g, ' ')

export function quotationMode(input: ModeInput): QuotationMode {
  const hasClient = present(input.cliente)
  const hasFolio = present(input.folio)
  const hasLines = (input.lineas?.length ?? 0) > 0
  if (hasClient && hasFolio) {
    throw new OdooError('Manda el cliente (para crear) o el folio (para una cotización que ya existe), no los dos.')
  }
  // A review never writes validity_date: a vigencia there would be signed and ignored.
  if (hasFolio && !hasLines && present(input.vigencia)) throw new OdooError(VALIDITY_NEEDS_LINES)
  if (hasFolio) return hasLines ? 'editar' : 'revisar'
  if (hasClient) {
    if (!hasLines) throw new OdooError('Para crear una cotización manda el cliente y sus líneas.')
    return 'crear'
  }
  throw new OdooError('Indica el cliente y las líneas (para crear) o el folio (para revisar o editar).')
}

const PRODUCT_FIELDS = [
  'producto_id', 'codigo', 'etm', 'marca', 'descripcion', 'clave_sat', 'cantidad', 'precio', 'descuento',
] as const satisfies readonly (keyof LineRequest)[]

function has(line: LineRequest, field: keyof LineRequest): boolean {
  const value = line[field]
  return typeof value === 'string' ? present(value) : value !== undefined
}

/** Product, note or section: exactly one. */
export function lineKind(line: LineRequest, n: number): LineKind {
  const isNote = has(line, 'nota')
  const isSection = has(line, 'seccion')
  if (isNote && isSection) throw new OdooError(`Línea ${n}: es nota o sección, no las dos.`)
  if (isNote || isSection) {
    if (PRODUCT_FIELDS.some((field) => has(line, field))) {
      throw new OdooError(`Línea ${n}: una ${isNote ? 'nota' : 'sección'} no lleva producto, cantidad ni precio.`)
    }
    return isNote ? 'nota' : 'seccion'
  }
  const identified = (['linea_id', 'producto_id', 'codigo', 'etm', 'descripcion'] as const).some((f) => has(line, f))
  if (!identified) {
    throw new OdooError(`Línea ${n}: falta el producto (producto_id, codigo, etm o descripcion), o que sea nota o seccion.`)
  }
  return 'producto'
}

/** Shape checks that need no Odoo: kinds, and linea_id only once and only when editing. */
export function assertQuotationLines(lines: readonly LineRequest[], mode: QuotationMode): LineKind[] {
  const seen = new Set<number>()
  return lines.map((line, index) => {
    const n = index + 1
    if (line.linea_id !== undefined) {
      if (mode !== 'editar') throw new OdooError(`Línea ${n}: linea_id solo sirve al editar una cotización que ya existe.`)
      if (seen.has(line.linea_id)) throw new OdooError(`Línea ${n}: la línea ${line.linea_id} viene repetida.`)
      seen.add(line.linea_id)
    }
    return lineKind(line, n)
  })
}

function startsWithWord(text: string, word: string): boolean {
  return text === word || text.startsWith(`${word} `)
}

function endsWithWord(text: string, word: string): boolean {
  return text === word || text.endsWith(` ${word}`)
}

/** '<CÓDIGO> <descripción> <MARCA>', the instance's naming; neither code nor brand repeated. */
export function productName(codigo: string | undefined, descripcion: string, marca?: string): string {
  const code = clean(codigo ?? '').toUpperCase()
  const brand = clean(marca ?? '').toUpperCase()
  let body = clean(descripcion)
  if (code && startsWithWord(fold(body), fold(code))) body = body.slice(code.length).trim()
  const parts = [code, body]
  if (brand && !endsWithWord(fold(body), fold(brand))) parts.push(brand)
  return parts.filter(Boolean).join(' ')
}

/** default_code may list several ETM codes, comma separated. */
export function splitEtm(value: string | false | null | undefined): string[] {
  if (typeof value !== 'string') return []
  return value.split(',').map((code) => code.trim()).filter(Boolean)
}

/** A product.product as the write tools read it (fixed projection, parsed). */
export interface OdooProduct {
  readonly id: number
  readonly name: string
  readonly etm: readonly string[]
  /** consu = good, service, combo. */
  readonly type: string
  /** delivery | order; null when Odoo sends none. */
  readonly invoicePolicy: string | null
  readonly saleOk: boolean
  readonly active: boolean
  readonly uom: string | null
  /** The SAT key's display name; null = missing (can't be stamped). */
  readonly satKey: string | null
}

export type ProductMatch =
  | { readonly estado: 'existe'; readonly producto: OdooProduct }
  /** otraMarca: same code under another brand (or none in the name) — the preview warns. */
  | { readonly estado: 'nuevo'; readonly otraMarca: readonly OdooProduct[] }
  | { readonly estado: 'ambiguo'; readonly candidatos: readonly OdooProduct[]; readonly total: number; readonly motivo: string }
  | { readonly estado: 'bloqueado'; readonly motivo: string; readonly producto?: OdooProduct }

export interface MatchOptions {
  /** This sale's lines (edit): linea_id → product id, null for a note or section. */
  readonly lineProducts?: ReadonlyMap<number, number | null>
  /** The single search hit its limit: a code or name match may be missing candidates. */
  readonly truncated?: boolean
}

const MAX_CANDIDATES = 5

function usable(product: OdooProduct): ProductMatch {
  if (!product.active) {
    return { estado: 'bloqueado', producto: product, motivo: `«${product.name}» (#${product.id}) está archivado: reactívalo en Odoo` }
  }
  if (!product.saleOk) {
    return {
      estado: 'bloqueado',
      producto: product,
      motivo: `«${product.name}» (#${product.id}) no se puede vender (sale_ok): actívalo en Odoo o elige otro`,
    }
  }
  return { estado: 'existe', producto: product }
}

/** One candidate wins; among several, only an exact full name decides. Never a guess. */
function pick(pool: readonly OdooProduct[], motivo: string, fullName?: string): ProductMatch {
  if (pool.length === 1) return usable(pool[0])
  if (fullName) {
    const exact = pool.filter((p) => fold(p.name) === fold(fullName))
    if (exact.length === 1) return usable(exact[0])
  }
  return { estado: 'ambiguo', candidatos: pool.slice(0, MAX_CANDIDATES), total: pool.length, motivo }
}

const blocked = (motivo: string): ProductMatch => ({ estado: 'bloqueado', motivo })

const TOO_MANY = 'demasiadas coincidencias en Odoo: precisa con producto_id o con el código completo'

/** Precedence: linea_id → producto_id → ETM → code (+brand) → exact name. */
function matchOne(line: LineRequest, rows: readonly OdooProduct[], byId: ReadonlyMap<number, OdooProduct>, opts: MatchOptions): ProductMatch {
  if (line.linea_id !== undefined) {
    const productId = opts.lineProducts?.get(line.linea_id)
    if (productId === undefined) return blocked(`la línea ${line.linea_id} no es de esta cotización`)
    if (productId === null) return blocked(`la línea ${line.linea_id} es una nota o sección en Odoo, no un producto`)
    if (line.producto_id !== undefined && line.producto_id !== productId) {
      return blocked('para cambiar de producto, quita la línea y agrega otra')
    }
    // A kept line already sells its product: archiving it later doesn't block editing the line.
    const product = byId.get(productId)
    if (product) return { estado: 'existe', producto: product }
    return blocked(opts.truncated ? TOO_MANY : `no pude leer el producto #${productId} de la línea`)
  }
  if (line.producto_id !== undefined) {
    const product = byId.get(line.producto_id)
    if (product) return usable(product)
    return blocked(opts.truncated ? TOO_MANY : `el producto #${line.producto_id} no existe en Odoo`)
  }
  if (opts.truncated) return blocked(TOO_MANY)

  const codigo = present(line.codigo) ? clean(line.codigo) : undefined
  const marca = present(line.marca) ? clean(line.marca) : undefined
  const descripcion = present(line.descripcion) ? clean(line.descripcion) : undefined
  const fullName = descripcion ? productName(codigo, descripcion, marca) : undefined
  const byCode = (p: OdooProduct) => !codigo || startsWithWord(fold(p.name), fold(codigo))
  const byBrand = (p: OdooProduct) => !marca || endsWithWord(fold(p.name), fold(marca))

  const etm = splitEtm(line.etm)
  if (etm.length > 0) {
    const etmMatches = rows.filter((p) => etm.every((code) => p.etm.includes(code)))
    if (etmMatches.length > 0) {
      const pool = etmMatches.filter((p) => byCode(p) && byBrand(p))
      if (pool.length === 0) {
        const other = codigo ? `el código ${codigo}${marca ? ` de ${marca}` : ''}` : `la marca ${marca}`
        return blocked(`el ETM ${line.etm?.trim()} y ${other} apuntan a productos distintos («${etmMatches[0].name}»)`)
      }
      return pick(pool, `${pool.length} productos tienen el ETM ${line.etm?.trim()}`, fullName)
    }
  }

  if (codigo) {
    const sameCode = rows.filter(byCode)
    const pool = sameCode.filter(byBrand)
    if (pool.length === 0) return { estado: 'nuevo', otraMarca: sameCode.slice(0, MAX_CANDIDATES) }
    return pick(pool, `${pool.length} productos tienen el código ${codigo}${marca ? ` de ${marca}` : ''}`, fullName)
  }

  if (descripcion) {
    const names = new Set([fold(descripcion), ...(fullName ? [fold(fullName)] : [])])
    const exact = rows.filter((p) => names.has(fold(p.name)))
    if (exact.length === 0) return { estado: 'nuevo', otraMarca: [] }
    return pick(exact, `${exact.length} productos se llaman "${descripcion}"`)
  }
  // Only an ETM that isn't in Odoo: a new product, which the plan then asks code and description for.
  return { estado: 'nuevo', otraMarca: [] }
}

export const isProductLine = (line: LineRequest): boolean => !has(line, 'nota') && !has(line, 'seccion')

/** Aligned with `lines`: null for notes and sections. */
export function matchProducts(
  lines: readonly LineRequest[],
  rows: readonly OdooProduct[],
  opts: MatchOptions = {},
): (ProductMatch | null)[] {
  const byId = new Map(rows.map((p) => [p.id, p]))
  return lines.map((line) => (isProductLine(line) ? matchOne(line, rows, byId, opts) : null))
}

/** What the single product search must cover for matchProducts; a line with an id is found by id. */
export function productSearchConditions(line: LineRequest): DomainTriple[] {
  if (line.linea_id !== undefined || line.producto_id !== undefined) return []
  const conditions: DomainTriple[] = []
  if (present(line.codigo)) conditions.push(['name', '=ilike', `${escapeLike(clean(line.codigo))} %`])
  for (const code of splitEtm(line.etm)) conditions.push(['default_code', 'ilike', escapeLike(code)])
  if (present(line.descripcion) && !present(line.codigo)) {
    conditions.push(['name', '=ilike', escapeLike(clean(line.descripcion))])
    if (present(line.marca)) conditions.push(['name', '=ilike', escapeLike(productName(undefined, line.descripcion, line.marca))])
  }
  return conditions
}

/** A line of the sale as Odoo reread it. */
export interface CurrentLine {
  readonly id: number
  readonly kind: LineKind
  /** Odoo's display_type: false for a product line. */
  readonly displayType: string | false
  readonly name: string
  readonly productId: number | null
  readonly qty: number
  readonly price: number
  readonly discount: number
  readonly sequence: number
  readonly subtotal: number | null
}

/** line_note → note; any other display type (section, subsection…) reads as a section. */
export function lineKindOf(displayType: string | false): LineKind {
  if (displayType === false) return 'producto'
  return displayType === 'line_note' ? 'nota' : 'seccion'
}

/** What a requested line becomes once resolved; productId is missing for a product still to create. */
export interface DesiredLine {
  readonly n: number
  readonly kind: LineKind
  readonly lineaId?: number
  readonly text?: string
  readonly productId?: number
  readonly qty?: number
  readonly price?: number
  readonly discount?: number
}

export type LineAction = 'se_queda' | 'cambia' | 'nueva' | 'se_quita'

export interface LineDiff {
  /** Per desired line, in order. */
  readonly actions: readonly { readonly n: number; readonly action: Exclude<LineAction, 'se_quita'>; readonly lineId: number | null }[]
  readonly removed: readonly CurrentLine[]
  /** null while a new product line has no product yet (it is created from the view first). */
  readonly commands: readonly SaleLineCommand[] | null
}

export const isEmptyDiff = (diff: LineDiff): boolean => diff.commands !== null && diff.commands.length === 0

function newLineVals(line: DesiredLine, sequence: number): SaleLineVals | null {
  if (line.kind === 'producto') {
    if (line.productId === undefined) return null
    return {
      product_id: line.productId,
      product_uom_qty: required(line.qty, line.n),
      price_unit: required(line.price, line.n),
      discount: line.discount ?? 0,
      sequence,
    }
  }
  return { display_type: line.kind === 'nota' ? 'line_note' : 'line_section', name: line.text ?? '', sequence }
}

function required(value: number | undefined, n: number): number {
  if (value === undefined) throw new OdooError(`Línea ${n}: falta la cantidad o el precio. No escribí nada.`)
  return value
}

/** Create: every line as [0, 0, vals], sequence (index + 1) × 10. */
export function createLineVals(desired: readonly DesiredLine[]): SaleLineVals[] {
  return desired.map((line, index) => {
    const vals = newLineVals(line, (index + 1) * 10)
    if (!vals) throw new OdooError(`Línea ${line.n}: el producto aún no existe en Odoo. No escribí nada.`)
    return vals
  })
}

function sameContent(current: CurrentLine, line: DesiredLine): boolean {
  if (current.kind !== line.kind) return false
  if (line.kind !== 'producto') return clean(current.name) === clean(line.text ?? '')
  return (
    line.productId !== undefined &&
    current.productId === line.productId &&
    line.qty !== undefined &&
    line.price !== undefined &&
    same(current.qty, line.qty) &&
    same(current.price, line.price) &&
    same(current.discount, line.discount ?? 0)
  )
}

// Odoo orders lines by (sequence, id).
const before = (a: CurrentLine, b: CurrentLine) => a.sequence < b.sequence || (a.sequence === b.sequence && a.id < b.id)

/** The trio always travels together on a product line: v19 recomputes the price from the quantity. */
function updateFor(current: CurrentLine, line: DesiredLine, sequence: number | undefined): SaleLineUpdate | null {
  const seq = sequence !== undefined ? { sequence } : {}
  if (line.kind === 'producto') {
    const qty = required(line.qty, line.n)
    const price = required(line.price, line.n)
    const discount = line.discount ?? 0
    const changed = !same(current.qty, qty) || !same(current.price, price) || !same(current.discount, discount)
    if (!changed && sequence === undefined) return null
    return { product_uom_qty: qty, price_unit: price, discount, ...seq }
  }
  const text = clean(line.text ?? '')
  const renamed = text !== clean(current.name)
  if (!renamed && sequence === undefined) return null
  return { ...(renamed ? { name: line.text ?? '' } : {}), ...seq }
}

/**
 * The full desired list against the sale: [1] for what changes, [2] for what is left out, [0] for
 * the new. A new line identical to a line left out is that line: a retried edit finds no change.
 */
export function diffLines(current: readonly CurrentLine[], desired: readonly DesiredLine[]): LineDiff {
  const byId = new Map(current.map((line) => [line.id, line]))
  const paired = new Map<number, CurrentLine>()
  for (const [index, line] of desired.entries()) {
    if (line.lineaId === undefined) continue
    const target = byId.get(line.lineaId)
    if (!target || (target.kind === 'producto') !== (line.kind === 'producto')) {
      throw new OdooError(`Línea ${line.n}: la línea ${line.lineaId} no corresponde a esta cotización. No escribí nada.`)
    }
    paired.set(index, target)
  }
  const free = current.filter((line) => !desired.some((d) => d.lineaId === line.id))
  for (const [index, line] of desired.entries()) {
    if (line.lineaId !== undefined) continue
    const match = free.findIndex((candidate) => sameContent(candidate, line))
    if (match >= 0) paired.set(index, free.splice(match, 1)[0])
  }

  const keptIndexes = [...paired.keys()].sort((a, b) => a - b)
  const kept = keptIndexes.map((index) => paired.get(index) as CurrentLine)
  const inOrder = kept.every((line, i) => i === 0 || before(kept[i - 1], line))
  const lastKept = keptIndexes.length ? keptIndexes[keptIndexes.length - 1] : -1
  const newOnlyAtEnd = desired.every((_, index) => paired.has(index) || index > lastKept)
  // Only reorder when needed: an untouched quote keeps its sequences.
  const resequence = !(inOrder && newOnlyAtEnd)
  const tailBase = kept.reduce((max, line) => Math.max(max, line.sequence), 0)

  const actions: { n: number; action: Exclude<LineAction, 'se_quita'>; lineId: number | null }[] = []
  const commands: SaleLineCommand[] = []
  let complete = true
  let tail = 0
  for (const [index, line] of desired.entries()) {
    const target = resequence ? (index + 1) * 10 : undefined
    const existing = paired.get(index)
    if (existing) {
      const sequence = target !== undefined && target !== existing.sequence ? target : undefined
      const update = updateFor(existing, line, sequence)
      actions.push({ n: line.n, action: update ? 'cambia' : 'se_queda', lineId: existing.id })
      if (update) commands.push([1, existing.id, update])
      continue
    }
    tail += 1
    const vals = newLineVals(line, target ?? tailBase + 10 * tail)
    actions.push({ n: line.n, action: 'nueva', lineId: null })
    if (vals) commands.push([0, 0, vals])
    else complete = false
  }
  for (const line of free) commands.push([2, line.id, 0])
  return { actions, removed: free, commands: complete ? commands : null }
}

/** Line subtotal before tax; Odoo computes the taxes when it saves. */
export function lineSubtotal(line: { qty?: number; price?: number; discount?: number }): number | null {
  if (line.qty === undefined || line.price === undefined) return null
  return round2(line.qty * line.price * (1 - (line.discount ?? 0) / 100))
}

export function estimateSubtotal(lines: readonly { qty?: number; price?: number; discount?: number }[]): number {
  return round2(lines.reduce((sum, line) => sum + (lineSubtotal(line) ?? 0), 0))
}

export interface PriceDifference {
  readonly linea: number
  readonly pedido: number
  readonly en_odoo: number
}

/** Lines whose saved price differs from the one asked; new lines pair in order by product. */
export function priceDifferences(
  expected: readonly { readonly n: number; readonly lineId: number | null; readonly productId: number; readonly price: number }[],
  rows: readonly { readonly id: number; readonly productId: number | null; readonly price: number }[],
  preexisting: ReadonlySet<number> = new Set(),
): PriceDifference[] {
  const used = new Set<number>()
  const out: PriceDifference[] = []
  for (const line of expected) {
    const row =
      line.lineId !== null
        ? rows.find((r) => r.id === line.lineId)
        : rows.find((r) => !used.has(r.id) && !preexisting.has(r.id) && r.productId === line.productId)
    if (!row) continue
    used.add(row.id)
    if (!same(row.price, line.price)) out.push({ linea: line.n, pedido: line.price, en_odoo: row.price })
  }
  return out
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`

export interface ConfirmEffects {
  readonly bienes: number
  readonly servicios: number
  /** Lines invoiceable right after confirming (invoice policy "order"). */
  readonly facturables: number
  readonly texto: string
}

/** What action_confirm sets off; a product to create counts as a good invoiced on delivery (instance default). */
export function confirmEffects(
  lines: readonly { readonly productId?: number }[],
  products: ReadonlyMap<number, Pick<OdooProduct, 'type' | 'invoicePolicy'>>,
): ConfirmEffects {
  let bienes = 0
  let bienesPorEntrega = 0
  let servicios = 0
  let serviciosPorEntrega = 0
  let facturables = 0
  for (const line of lines) {
    const product = line.productId !== undefined ? products.get(line.productId) : undefined
    const type = product?.type ?? 'consu'
    const policy = product ? product.invoicePolicy : 'delivery'
    if (policy === 'order') facturables += 1
    if (type === 'service') {
      servicios += 1
      if (policy !== 'order') serviciosPorEntrega += 1
    } else {
      bienes += 1
      if (policy !== 'order') bienesPorEntrega += 1
    }
  }
  if (lines.length === 0) {
    return { bienes, servicios, facturables, texto: 'No tiene productos: no se puede confirmar.' }
  }

  const parts: string[] = []
  if (bienes > 0) {
    const later = bienesPorEntrega === bienes ? 'se facturan' : `${bienesPorEntrega} se facturan`
    parts.push(`Odoo creará la entrega OFI/OUT de ${plural(bienes, 'bien', 'bienes')}${bienesPorEntrega ? ` (${later} cuando la validen en Odoo)` : ''}`)
  }
  if (serviciosPorEntrega > 0) {
    parts.push(`${plural(serviciosPorEntrega, 'servicio se factura', 'servicios se facturan')} cuando se capture en Odoo la cantidad entregada`)
  }
  if (facturables > 0) {
    parts.push(`${plural(facturables, 'línea se podrá facturar', 'líneas se podrán facturar')} en cuanto se confirme`)
  }
  parts.push('la fecha de la orden pasará a hoy')
  const texto = `${parts.join('; ')}. No se manda correo al cliente.`
  return { bienes, servicios, facturables, texto: texto.charAt(0).toUpperCase() + texto.slice(1) }
}

/** New products in the shape odoo_save_product takes: what the products authorization signs. */
export interface ProductForCreation {
  readonly codigo: string
  readonly descripcion: string
  readonly marca?: string
  readonly etm?: string
  readonly precio: number
  readonly clave_sat?: string
}

/** The same product for the screen: every field present, null when empty. */
export interface NewProductView {
  readonly codigo: string
  readonly descripcion: string
  readonly marca: string | null
  readonly etm: string | null
  readonly precio: number
  readonly clave_sat: string | null
  readonly nombre_en_odoo: string
}

export interface PreviewProduct {
  readonly id: number
  readonly nombre: string
  readonly etm: string | null
  readonly clase: 'bien' | 'servicio' | 'combo'
  readonly factura_por: 'entrega' | 'pedido' | null
  readonly clave_sat: string | null
}

export function previewProduct(product: OdooProduct): PreviewProduct {
  return {
    id: product.id,
    nombre: product.name,
    etm: product.etm.length ? product.etm.join(', ') : null,
    clase: product.type === 'service' ? 'servicio' : product.type === 'combo' ? 'combo' : 'bien',
    factura_por: product.invoicePolicy === 'order' ? 'pedido' : product.invoicePolicy === 'delivery' ? 'entrega' : null,
    clave_sat: product.satKey,
  }
}

export type ProductState = 'existe' | 'nuevo' | 'ambiguo' | 'bloqueado'

/** One row of the preview (and of the view): what was asked and what Odoo has. */
export interface PreviewLine {
  /** Position in the requested list; null for a line that an edit removes. */
  readonly n: number | null
  readonly tipo: LineKind
  /** Edit only. */
  readonly accion: LineAction | null
  readonly linea_id?: number
  readonly texto?: string
  readonly pedido?: string
  readonly estado?: ProductState
  readonly producto?: PreviewProduct
  readonly propuesto?: { readonly nombre: string; readonly clave_sat: string | null }
  readonly candidatos?: readonly { readonly id: number; readonly nombre: string }[]
  readonly motivo?: string
  readonly cantidad?: number | null
  readonly precio?: number | null
  readonly descuento?: number
  readonly subtotal?: number | null
  readonly antes?: { readonly cantidad?: number; readonly precio?: number; readonly descuento?: number; readonly texto?: string }
}

export interface PlanInput {
  readonly mode: 'crear' | 'editar'
  readonly lines: readonly LineRequest[]
  readonly matches: readonly (ProductMatch | null)[]
  /** The sale's lines (edit only). */
  readonly current?: readonly CurrentLine[]
}

export interface LinePlan {
  readonly lineas: PreviewLine[]
  readonly desired: DesiredLine[]
  readonly nuevos: NewProductView[]
  readonly paraAlta: ProductForCreation[]
  readonly bloqueos: string[]
  readonly avisos: string[]
  readonly subtotal: number
  /** Lines whose product doesn't exist yet: a save waits for the view to create them. */
  readonly pendingNew: number[]
  /** Edit only. */
  readonly diff: LineDiff | null
}

function requested(line: LineRequest): string {
  if (line.linea_id !== undefined) return `línea #${line.linea_id}`
  if (line.producto_id !== undefined) return `producto #${line.producto_id}`
  const text = [line.codigo, line.descripcion, line.marca].filter(present).map(clean).join(' ')
  if (present(line.etm)) return text ? `${text} (ETM ${line.etm.trim()})` : `ETM ${line.etm.trim()}`
  return text
}

/** Mirrors the write catalog's line text (tested against it): longer input only echoes a kept line. */
export const DISPLAY_TEXT_MAX = 300

const longText = (n: number) => `Línea ${n}: una nota o sección nueva o cambiada lleva hasta ${DISPLAY_TEXT_MAX} caracteres.`

/** 'Línea 2' / 'Líneas 2, 3 y 5'. */
export function listOfLines(numbers: readonly number[]): string {
  if (numbers.length === 1) return `Línea ${numbers[0]}`
  return `Líneas ${numbers.slice(0, -1).join(', ')} y ${numbers[numbers.length - 1]}`
}

/** Turns the resolved lines into what the preview shows, what blocks a save and what would be written. */
export function planQuotationLines(input: PlanInput): LinePlan {
  const lineas: PreviewLine[] = []
  const desired: DesiredLine[] = []
  const nuevos: NewProductView[] = []
  const paraAlta: ProductForCreation[] = []
  const altaByName = new Map<string, { n: number; product: ProductForCreation }>()
  const bloqueos: string[] = []
  const avisos: string[] = []
  const withoutSat: number[] = []
  const pendingNew: number[] = []
  const currentById = new Map((input.current ?? []).map((line) => [line.id, line]))

  for (const [index, line] of input.lines.entries()) {
    const n = index + 1
    const kind = lineKind(line, n)
    const existing = line.linea_id !== undefined ? currentById.get(line.linea_id) : undefined

    if (kind !== 'producto') {
      const text = kind === 'nota' ? (line.nota ?? '') : (line.seccion ?? '')
      if (line.linea_id !== undefined && !existing) {
        bloqueos.push(`Línea ${n}: la línea ${line.linea_id} no es de esta cotización.`)
      } else if (existing && existing.kind !== kind) {
        bloqueos.push(
          `Línea ${n}: la línea ${existing.id} es ${existing.kind === 'producto' ? 'un producto' : existing.kind === 'nota' ? 'una nota' : 'una sección'} en Odoo: para cambiarla de tipo, quítala y agrega otra.`,
        )
      }
      if (input.mode === 'crear' && text.trim().length > DISPLAY_TEXT_MAX) bloqueos.push(longText(n))
      lineas.push({ n, tipo: kind, accion: null, texto: text.trim(), ...(line.linea_id !== undefined ? { linea_id: line.linea_id } : {}) })
      desired.push({ n, kind, text: text.trim(), ...(existing && existing.kind === kind ? { lineaId: existing.id } : {}) })
      continue
    }

    const qty = line.cantidad
    const price = line.precio
    const discount = line.descuento ?? 0
    if (qty === undefined) bloqueos.push(`Línea ${n}: falta la cantidad.`)
    if (price === undefined) bloqueos.push(`Línea ${n}: falta el precio (el asistente no lo inventa).`)
    else if (price === 0) avisos.push(`Línea ${n}: precio 0 — confírmalo antes de guardar.`)

    const base = {
      n,
      tipo: 'producto' as const,
      accion: null,
      pedido: requested(line),
      cantidad: qty ?? null,
      precio: price ?? null,
      descuento: discount,
      subtotal: lineSubtotal({ qty, price, discount }),
      ...(line.linea_id !== undefined ? { linea_id: line.linea_id } : {}),
    }
    const keep = existing && existing.kind === 'producto' ? { lineaId: existing.id } : {}
    const match = input.matches[index]
    if (!match) throw new OdooError(`Línea ${n}: no pude resolver el producto.`)

    if (match.estado === 'existe') {
      if (!match.producto.satKey) withoutSat.push(n)
      lineas.push({ ...base, estado: 'existe', producto: previewProduct(match.producto) })
      desired.push({ n, kind, productId: match.producto.id, qty, price, discount, ...keep })
      continue
    }
    desired.push({ n, kind, qty, price, discount, ...keep })

    if (match.estado === 'ambiguo') {
      bloqueos.push(`Línea ${n}: ${match.motivo}: elige uno (producto_id).`)
      lineas.push({
        ...base,
        estado: 'ambiguo',
        candidatos: match.candidatos.map((p) => ({ id: p.id, nombre: p.name })),
        motivo: match.total > match.candidatos.length ? `${match.motivo} (se muestran ${match.candidatos.length})` : match.motivo,
      })
      continue
    }
    if (match.estado === 'bloqueado') {
      bloqueos.push(`Línea ${n}: ${match.motivo}.`)
      lineas.push({ ...base, estado: 'bloqueado', motivo: match.motivo, ...(match.producto ? { producto: previewProduct(match.producto) } : {}) })
      continue
    }

    // A product to create: from the view's button only, with what odoo_save_product takes.
    pendingNew.push(n)
    const codigo = present(line.codigo) ? clean(line.codigo).toUpperCase() : null
    const descripcion = present(line.descripcion) ? clean(line.descripcion) : null
    const marca = present(line.marca) ? clean(line.marca).toUpperCase() : undefined
    const etm = present(line.etm) ? line.etm.trim() : undefined
    const claveSat = line.clave_sat
    const nombre = descripcion ? productName(codigo ?? undefined, descripcion, marca) : null
    lineas.push({ ...base, estado: 'nuevo', propuesto: { nombre: nombre ?? base.pedido, clave_sat: claveSat ?? null } })
    if (!codigo || !descripcion || !nombre) {
      bloqueos.push(`Línea ${n}: el producto no existe en Odoo; para darlo de alta hacen falta su código y su descripción.`)
      continue
    }
    if (nombre.length > PRODUCT_NAME_MAX) {
      bloqueos.push(`Línea ${n}: el nombre del producto nuevo pasa de ${PRODUCT_NAME_MAX} caracteres.`)
      continue
    }
    if (etm !== undefined && !ETM_CODE_LIST.test(etm)) {
      bloqueos.push(`Línea ${n}: el ETM debe ser de 9 dígitos (o varios separados por comas).`)
      continue
    }
    if (price === undefined) continue
    if (match.otraMarca.length > 0) {
      const others = match.otraMarca.map((p) => `«${p.name}» (#${p.id})`).join(', ')
      avisos.push(`Línea ${n}: en Odoo ya hay productos con el código ${codigo} de otra marca o sin ella (${others}): se dará de alta uno nuevo.`)
    }
    if (!claveSat) withoutSat.push(n)

    const product: ProductForCreation = {
      codigo,
      descripcion,
      ...(marca ? { marca } : {}),
      ...(etm ? { etm } : {}),
      precio: price,
      ...(claveSat ? { clave_sat: claveSat } : {}),
    }
    const key = fold(nombre)
    const twin = altaByName.get(key)
    if (twin) {
      if (twin.product.etm !== product.etm || twin.product.clave_sat !== product.clave_sat) {
        bloqueos.push(`Líneas ${twin.n} y ${n}: proponen el mismo producto nuevo con ETM o clave SAT distintos.`)
      }
      continue
    }
    altaByName.set(key, { n, product })
    paraAlta.push(product)
    nuevos.push({
      codigo,
      descripcion,
      marca: marca ?? null,
      etm: etm ?? null,
      precio: price,
      clave_sat: claveSat ?? null,
      nombre_en_odoo: nombre,
    })
  }

  if (paraAlta.length > MAX_NEW_PRODUCTS) {
    bloqueos.push(`Son ${paraAlta.length} productos nuevos: el asistente da de alta hasta ${MAX_NEW_PRODUCTS} a la vez.`)
  }
  if (withoutSat.length > 0) {
    avisos.push(`${listOfLines(withoutSat)} sin clave SAT: no podrá${withoutSat.length === 1 ? '' : 'n'} timbrarse hasta capturarla en Odoo.`)
  }

  let diff: LineDiff | null = null
  if (input.mode === 'editar' && bloqueos.length === 0) {
    diff = diffLines(input.current ?? [], desired)
    const byN = new Map(diff.actions.map((a) => [a.n, a]))
    for (const [i, row] of lineas.entries()) {
      const action = row.n !== null ? byN.get(row.n) : undefined
      if (!action) continue
      const before = action.lineId !== null ? currentById.get(action.lineId) : undefined
      lineas[i] = {
        ...row,
        accion: action.action,
        ...(action.lineId !== null ? { linea_id: action.lineId } : {}),
        ...(action.action === 'cambia' && before ? { antes: beforeOf(before) } : {}),
      }
    }
    for (const line of diff.removed) lineas.push(removedLine(line))
    // Removing or rewriting a line the input can't express would drop the owner's discount or the like.
    const touched = [
      ...diff.removed,
      ...diff.actions.flatMap((a) => (a.action === 'cambia' && a.lineId !== null ? [currentById.get(a.lineId)] : [])),
    ]
    for (const line of touched) {
      const why = line ? unechoableReason(line) : null
      if (line && why) bloqueos.push(stuckLine(line, why))
    }
    // A kept note may be longer than the writer takes; only one being written must fit.
    for (const line of desired) {
      const action = byN.get(line.n)
      if (line.kind === 'producto' || !action || (line.text ?? '').length <= DISPLAY_TEXT_MAX) continue
      const kept = action.lineId !== null ? currentById.get(action.lineId) : undefined
      if (action.action === 'nueva' || (kept && clean(kept.name) !== clean(line.text ?? ''))) bloqueos.push(longText(line.n))
    }
  }

  return {
    lineas,
    desired,
    nuevos,
    paraAlta,
    bloqueos,
    avisos,
    subtotal: estimateSubtotal(desired.filter((d) => d.kind === 'producto')),
    pendingNew,
    diff,
  }
}

function beforeOf(line: CurrentLine): NonNullable<PreviewLine['antes']> {
  return line.kind === 'producto' ? { cantidad: line.qty, precio: line.price, descuento: line.discount } : { texto: line.name }
}

function removedLine(line: CurrentLine): PreviewLine {
  if (line.kind !== 'producto') return { n: null, tipo: line.kind, accion: 'se_quita', linea_id: line.id, texto: line.name }
  return {
    n: null,
    tipo: 'producto',
    accion: 'se_quita',
    linea_id: line.id,
    pedido: line.name,
    cantidad: line.qty,
    precio: line.price,
    descuento: line.discount,
    subtotal: line.subtotal,
  }
}

/** A sale as it is (review mode): every line marked as existing. */
export function currentPreviewLines(
  current: readonly CurrentLine[],
  products: ReadonlyMap<number, OdooProduct>,
): PreviewLine[] {
  return current.map((line, index): PreviewLine => {
    if (line.kind !== 'producto') return { n: index + 1, tipo: line.kind, accion: null, linea_id: line.id, texto: line.name }
    const product = line.productId !== null ? products.get(line.productId) : undefined
    return {
      n: index + 1,
      tipo: 'producto',
      accion: null,
      linea_id: line.id,
      pedido: line.name,
      estado: 'existe',
      ...(product ? { producto: previewProduct(product) } : {}),
      cantidad: line.qty,
      precio: line.price,
      descuento: line.discount,
      subtotal: line.subtotal ?? lineSubtotal({ qty: line.qty, price: line.price, discount: line.discount }),
    }
  })
}

/** quotationLine's own limits (quotations.ts builds its zod schema from these). */
export const LINE_QTY_MAX = 100_000
export const LINE_PRICE_MAX = 10_000_000
/** Above the writer's 300 so an owner's long note can come back unchanged; a new or changed one is blocked. */
export const NOTE_ECHO_MAX = 2_000

/** Why a current line can't travel back through quotationLine (an owner's discount, a 0-qty line…); null if it can. */
export function unechoableReason(line: CurrentLine): string | null {
  if (line.kind !== 'producto') {
    if (!line.name.trim()) return 'no tiene texto'
    return line.name.length > NOTE_ECHO_MAX ? `pasa de ${NOTE_ECHO_MAX} caracteres` : null
  }
  if (line.productId === null) return 'no tiene producto'
  if (!(line.qty > 0) || line.qty > LINE_QTY_MAX) return `tiene cantidad ${line.qty}`
  if (line.price < 0 || line.price > LINE_PRICE_MAX) return `tiene precio ${line.price}`
  if (line.discount < 0 || line.discount > 100) return `tiene descuento de ${line.discount} %`
  return null
}

const SHORT_NAME = 60
const shortName = (name: string) => {
  const text = clean(name)
  return text.length > SHORT_NAME ? `${text.slice(0, SHORT_NAME - 1)}…` : text
}

/** Review: the lines lineas_como_entrada leaves out, so an edit from it would remove them. */
export function unechoableWarnings(current: readonly CurrentLine[]): string[] {
  return current.flatMap((line, index) => {
    const why = unechoableReason(line)
    if (!why) return []
    return [
      `La línea ${index + 1} («${shortName(line.name)}») ${why}: el asistente no puede conservarla al editar (no viene en lineas_como_entrada); para cambiar esta cotización, hazlo en Odoo. Confirmarla sí se puede.`,
    ]
  })
}

const stuckLine = (line: CurrentLine, why: string) =>
  `La línea #${line.id} («${shortName(line.name)}») ${why}: el asistente no puede conservarla ni cambiarla; edita esta cotización en Odoo.`

/** The sale's lines as input with their linea_id: the starting point of an edit. */
export function linesAsInput(current: readonly CurrentLine[]): LineRequest[] {
  return current.filter((line) => unechoableReason(line) === null).map((line): LineRequest => {
    if (line.kind === 'nota') return { linea_id: line.id, nota: line.name }
    if (line.kind === 'seccion') return { linea_id: line.id, seccion: line.name }
    return {
      linea_id: line.id,
      ...(line.productId !== null ? { producto_id: line.productId } : {}),
      cantidad: line.qty,
      precio: line.price,
      ...(line.discount ? { descuento: line.discount } : {}),
    }
  })
}

export const SALE_STATE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  draft: 'borrador',
  sent: 'enviada',
  sale: 'venta confirmada',
  cancel: 'cancelada',
})

export const PICKING_STATE_LABEL: Readonly<Record<string, string>> = Object.freeze({
  draft: 'Borrador',
  waiting: 'Esperando otra operación',
  confirmed: 'En espera',
  assigned: 'Lista',
  done: 'Hecha',
  cancel: 'Cancelada',
})

export interface ReadinessSale {
  readonly name: string
  readonly state: string
  readonly invoiceStatus: string | null
  readonly amountTotal: number
}

export interface ReadinessInvoice {
  readonly id: number
  /** false while a draft (no folio yet). */
  readonly name: string | false
  readonly state: string
  readonly moveType: string
  readonly amountTotal: number
}

export interface ReadinessLine {
  readonly name: string
  readonly displayType: string | false
  readonly productId: number | null
  readonly isDownpayment: boolean
  readonly qty: number
  readonly qtyDelivered: number
  readonly qtyInvoiced: number
  readonly qtyToInvoice: number
  readonly price: number
}

export type InvoiceReadiness =
  | { readonly estado: 'lista' }
  | { readonly estado: 'ya_existe'; readonly factura: { readonly id: number; readonly total: number } }
  | { readonly estado: 'bloqueada'; readonly motivo: string }

const refuse = (motivo: string): InvoiceReadiness => ({ estado: 'bloqueada', motivo })

/** Preconditions of a FULL draft invoice, in order; anything else is done in Odoo (ADR-040). */
export function invoiceReadiness(
  sale: ReadinessSale,
  lines: readonly ReadinessLine[],
  products: ReadonlyMap<number, Pick<OdooProduct, 'type' | 'invoicePolicy'>>,
  pickings: readonly { readonly name: string; readonly state: string }[],
  invoices: readonly ReadinessInvoice[] = [],
): InvoiceReadiness {
  if (sale.state === 'draft' || sale.state === 'sent') {
    return refuse(`La ${sale.name} sigue como cotización: primero confírmala (vista previa con el folio y, con tu sí, odoo_confirm_quotation).`)
  }
  if (sale.state === 'cancel') return refuse(`La ${sale.name} está cancelada.`)
  if (sale.state !== 'sale') return refuse(`La ${sale.name} no es una venta confirmada (${sale.state}).`)

  const live = invoices.filter((inv) => inv.state !== 'cancel')
  const draft = live.find((inv) => inv.state === 'draft' && inv.moveType === 'out_invoice')
  if (draft) return { estado: 'ya_existe', factura: { id: draft.id, total: draft.amountTotal } }
  if (live.some((inv) => inv.state === 'draft')) {
    return refuse(`La ${sale.name} tiene una nota de crédito en borrador: resuélvela en Odoo.`)
  }
  const posted = live.filter((inv) => inv.state === 'posted')
  if (posted.length > 0) {
    const folios = posted.map((inv) => inv.name || `#${inv.id}`).join(', ')
    return refuse(`La ${sale.name} ya está facturada (${folios}): las facturas parciales o adicionales se hacen en Odoo.`)
  }
  if (lines.some((line) => line.isDownpayment)) return refuse(`La ${sale.name} tiene anticipos: la factura final hazla en Odoo.`)

  const productLines = lines.filter((line) => line.displayType === false)
  if (productLines.length === 0) return refuse(`La ${sale.name} no tiene productos que facturar.`)
  if (sale.amountTotal <= 0 || productLines.some((line) => line.price < 0 || line.qtyToInvoice < 0)) {
    return refuse(`Odoo convertiría la ${sale.name} en nota de crédito: hazla en Odoo.`)
  }
  const over = productLines.find((line) => line.qtyToInvoice > line.qty + EPSILON)
  if (sale.invoiceStatus === 'upselling' || over) {
    const which = over ?? productLines.find((line) => line.qtyDelivered > line.qty + EPSILON) ?? productLines[0]
    return refuse(`Se entregó más de lo vendido en «${which.name}»: ajusta la venta o factura en Odoo.`)
  }
  if (productLines.some((line) => line.qtyInvoiced > EPSILON)) {
    return refuse(`La ${sale.name} ya tiene una parte facturada: la factura del asistente es siempre completa; hazla en Odoo.`)
  }

  const complete = (line: ReadinessLine) => line.qty > 0 && same(line.qtyToInvoice, line.qty)
  const pending = productLines.filter((line) => !complete(line))
  if (pending.length === 0) return { estado: 'lista' }

  const isService = (line: ReadinessLine) => line.productId !== null && products.get(line.productId)?.type === 'service'
  const goods = pending.filter((line) => !isService(line))
  const ready = productLines.length - pending.length
  if (goods.length > 0 && goods.every((line) => line.qtyDelivered <= EPSILON) && ready === 0) {
    const open = pickings.filter((p) => p.state !== 'done' && p.state !== 'cancel')
    const where = open.length
      ? `${open.length === 1 ? 'la entrega' : 'las entregas'} ${open.map((p) => `${p.name} está «${PICKING_STATE_LABEL[p.state] ?? p.state}»`).join(', ')}, sin validar`
      : 'no tiene una entrega pendiente en Odoo'
    return refuse(
      `Nada que facturar todavía: ${plural(goods.length, 'bien se factura', 'bienes se facturan')} por entrega y ${where}. Valídala en Odoo y vuelve a pedírmelo. El asistente no toca inventario.`,
    )
  }
  const service = pending.find((line) => isService(line) && line.qtyDelivered <= EPSILON)
  if (service && goods.length === 0) {
    return refuse(`Captura la cantidad entregada del servicio «${service.name}» en la venta en Odoo.`)
  }
  return refuse(
    `Solo está entregada una parte (${ready} de ${plural(productLines.length, 'línea', 'líneas')}): la factura del asistente es siempre completa.`,
  )
}
