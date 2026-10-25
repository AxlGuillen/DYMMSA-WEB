/**
 * save_quotation (#155 D, ADR-041): create a quotation, edit it by line, or move it between states — one intention
 * per call (decision 1). The rules live in quotations-store.ts and quotation-edit.ts, shared with the routes and the
 * cotizador, so the auto-learn, the ADR-013 snapshot and the validation are the app's own. Creating, editing and
 * every state change but borrador → en_revision ask for the yes; the key binds to the quotation's `version`.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, refOf, versionOf, writeResult, type Changes } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { calculateLineTotal, calculateQuotationTotal, isNotSold, isProductItem, resolveDymmsaDescription } from '@/lib/business-rules'
import { DELIVERY_TIME_TOKENS } from '@/lib/delivery'
import {
  applyLineChanges,
  EditError,
  newSeparator,
  prefillLine,
  toItemRow,
  type LineChange,
  type LineSet,
} from '@/lib/quotation-edit'
import { getBlockingIssues } from '@/lib/quotation-validation'
import { EDITABLE_QUOTATION_STATUSES, createQuotation, linkedOrderBlocks, lookupEtms, sendForApproval, setQuotationStatus, updateQuotation } from '@/lib/quotations-store'
import { QUOTATION_STATUS_TOKENS } from '@/lib/quotation-status'
import { approvalFromToken, approvalToken, soldFromToken, soldToken } from '@/lib/tokens'
import { nextDymmsaCode } from '@/lib/products-store'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'
import type { DeliveryTime, EtmProduct, Quotation, QuotationItem, QuotationItemRow, QuotationStatus } from '@/types/database'
import { approvalLink, resolveQuotation } from './quotations'

// ── input ────────────────────────────────────────────────────────────────────

/** A line to create: all of them when the quotation is new; with `cotizacion`, the ones to add (`despues_de` places them). */
export interface LineInput {
  etm?: string
  seccion?: string
  cantidad?: number
  precio?: number
  entrega?: string
  codigo?: string
  marca?: string
  descripcion?: string
  /** Only when adding to an existing quotation: after the original line N (0 = first, omitted = last). */
  despues_de?: number
}

export interface ChangeInput {
  /** N, [N, M] or "todas". */
  linea?: number | number[] | 'todas'
  etm?: string
  precio?: number
  cantidad?: number
  entrega?: string
  se_vende?: string
  aprobacion?: string
  descripcion_dymmsa?: string
  quitar?: true
  /** Moves `linea` after the original line N (0 = first). */
  despues_de?: number
}

export interface SaveQuotationInput {
  cotizacion?: string
  nombre?: string
  cliente?: string
  lineas?: LineInput[]
  cambios?: ChangeInput[]
  estado?: string
  version?: string
}

const NEW_ETM = 'nuevo'
/** Lines the summary spells out; the key covers all of them. */
const LINES_SHOWN = 60

const orToolError = <T>(run: () => T): T => {
  try {
    return run()
  } catch (error) {
    if (error instanceof EditError) throw new ToolError(error.message)
    throw error
  }
}

const deliveryOf = (token: string): DeliveryTime => {
  const db = DELIVERY_TIME_TOKENS.toDb(token)
  if (!db) throw new ToolError(`Entrega inválida "${token}": usa ${DELIVERY_TIME_TOKENS.tokens.join(' | ')}`)
  return db
}

// ── presentation ─────────────────────────────────────────────────────────────

const money = (n: number | null) => (n === null ? null : Math.round(n * 100) / 100)

/** A row for the summary, with the position it will have; the cotizador's own totals. */
function lineView(row: QuotationItemRow, linea: number) {
  if (!isProductItem(row)) return { linea, seccion: row.section_label, ...(row.separator_color ? { color: row.separator_color } : {}) }
  return {
    linea,
    etm: row.etm,
    codigo: row.model_code,
    descripcion: row.description_es || row.description,
    cantidad: row.quantity,
    precio: row.unit_price,
    importe: money(calculateLineTotal(row.unit_price, row.quantity)),
    entrega: DELIVERY_TIME_TOKENS.toToken(row.delivery_time),
    se_vende: soldToken(row.is_sold),
    aprobacion: approvalToken(row.is_approved),
  }
}

const fieldsOf = (row: QuotationItemRow) =>
  isProductItem(row)
    ? { precio: row.unit_price, cantidad: row.quantity, entrega: DELIVERY_TIME_TOKENS.toToken(row.delivery_time), se_vende: soldToken(row.is_sold), aprobacion: approvalToken(row.is_approved), descripcion_dymmsa: row.dymmsa_description || null }
    : { seccion: row.section_label, color: row.separator_color ?? null }

const labelOf = (row: QuotationItemRow) => (isProductItem(row) ? `ETM ${row.etm}` : `sección «${row.section_label}»`)

/** Per line: only what changed, antes → ahora; removed and new lines say so; a moved line says where it goes. */
function lineChanges(original: readonly QuotationItemRow[], final: readonly QuotationItemRow[], origin: readonly (number | null)[], movedLines: ReadonlySet<number>): Changes {
  const changes: Record<string, { antes: unknown; ahora: unknown }> = {}
  const kept = new Set<number>()
  final.forEach((row, index) => {
    const from = origin[index]
    if (from === null) {
      changes[`linea nueva ${index + 1}`] = { antes: null, ahora: labelOf(row) + (isProductItem(row) ? ` × ${row.quantity ?? '?'}` : '') }
      return
    }
    kept.add(from)
    const before = original[from - 1]
    const delta = diff(fieldsOf(before), fieldsOf(row))
    const moved = movedLines.has(from)
    if (Object.keys(delta).length === 0 && !moved) return
    const antes: Record<string, unknown> = {}
    const ahora: Record<string, unknown> = {}
    for (const [key, change] of Object.entries(delta)) {
      antes[key] = change.antes
      ahora[key] = change.ahora
    }
    if (moved) {
      antes.posicion = from
      ahora.posicion = index + 1
    }
    changes[`linea ${from} (${labelOf(before)})`] = { antes, ahora }
  })
  original.forEach((row, index) => {
    if (!kept.has(index + 1)) changes[`linea ${index + 1} (${labelOf(row)})`] = { antes: 'estaba', ahora: 'se quita' }
  })
  return changes
}

// ── the quotation as the store reads it ──────────────────────────────────────

export type StoredQuotation = Quotation & { quotation_items: QuotationItem[] }

export async function loadQuotation(db: Db, id: string): Promise<StoredQuotation> {
  const { data, error } = await db
    .from('quotations')
    .select('*, quotation_items(*)')
    .eq('id', id)
    .order('sort_order', { foreignTable: 'quotation_items', ascending: true })
    .limit(5000, { foreignTable: 'quotation_items' })
    .single()
  if (error || !data) throw new ToolError(error?.code === 'PGRST116' ? 'Cotización no encontrada' : `Error al leer la cotización: ${error?.message ?? 'sin datos'}`)
  return data as StoredQuotation
}

const versionOfQuotation = (q: StoredQuotation) => versionOf(q.updated_at, q.quotation_items.map((i) => i.id))

const NOT_EDITABLE: Partial<Record<QuotationStatus, string>> = {
  rejected: 'Está rechazada: cámbiala a borrador primero (save_quotation con estado: borrador).',
  converted_to_order: 'Está convertida a orden: elimina la orden en la app y reábrela (estado: borrador) antes de editarla.',
}

function productEtms(lines: readonly LineInput[]): string[] {
  return [...new Set(lines.filter((l) => l.etm !== undefined && l.etm.trim().toLowerCase() !== NEW_ETM).map((l) => (l.etm as string).trim()))]
}

type Catalog = { found: Map<string, EtmProduct>; notFound: string[] }

/** The catalog rows of the ETMs a set of lines names; the lookup the cotizador runs in the browser, here on the server. */
async function catalogFor(db: Db, lines: readonly LineInput[]): Promise<Catalog> {
  const etms = productEtms(lines)
  if (etms.length === 0) return { found: new Map(), notFound: [] }
  const lookup = await lookupEtms(db, etms, lines.map((l) => l.codigo ?? '').filter(Boolean))
  return { found: new Map(lookup.found.map((p) => [p.etm, p])), notFound: lookup.notFound }
}

/** Typed lines to editable rows: the quoter's merge, `nuevo` assigned the next DYMMSA-N, sections checked. */
async function buildRows(db: Db, lines: readonly LineInput[], catalog: Catalog, avisos: string[]): Promise<QuotationItemRow[]> {
  const wantsNew = lines.some((l) => l.etm?.trim().toLowerCase() === NEW_ETM)
  let next = wantsNew ? await nextDymmsaCode(db) : 0
  return orToolError(() =>
    lines.map((line, index) => {
      const where = `Línea ${index + 1}`
      if (line.seccion !== undefined && line.etm !== undefined) throw new ToolError(`${where}: o es una sección (seccion) o un producto (etm), no las dos.`)
      if (line.seccion !== undefined) {
        const label = line.seccion.trim()
        if (!label) throw new ToolError(`${where}: la sección necesita un nombre.`)
        return newSeparator(label, null)
      }
      if (line.etm === undefined || !line.etm.trim()) throw new ToolError(`${where}: indica el ETM del producto (o "nuevo" para uno interno) o una sección.`)
      const isNew = line.etm.trim().toLowerCase() === NEW_ETM
      const etm = isNew ? `DYMMSA-${next++}` : line.etm.trim()
      if (isNew) avisos.push(`«nuevo» quedó como ${etm}.`)
      return prefillLine(
        {
          etm,
          quantity: line.cantidad ?? null,
          unit_price: line.precio,
          delivery_time: line.entrega === undefined ? undefined : deliveryOf(line.entrega),
          model_code: line.codigo,
          brand: line.marca?.trim().toUpperCase(),
          description: line.descripcion,
        },
        catalog.found.get(etm) ?? null,
      )
    }),
  )
}

/** What auto-learn will do to the ETM catalog on saving, said before: new ETMs and the prices that change. */
function learnWarning(rows: readonly QuotationItemRow[], catalog: Catalog): string | null {
  const products = rows.filter(isProductItem)
  const fresh = new Set(products.filter((r) => !catalog.found.has(r.etm)).map((r) => r.etm)).size
  const prices = products.filter((r) => {
    const known = catalog.found.get(r.etm)
    return known && r.unit_price != null && known.price !== r.unit_price && !isNotSold(r)
  }).length
  if (fresh === 0 && prices === 0) return null
  const parts = [fresh > 0 ? `${fresh} ETM nuevo${fresh === 1 ? '' : 's'} entran al catálogo` : null, prices > 0 ? `${prices} precio${prices === 1 ? '' : 's'} de catálogo cambian al de esta cotización` : null]
  return `Al guardar, el catálogo ETM aprende de estas líneas: ${parts.filter(Boolean).join(' y ')}.`
}

const blockMessages = (rows: readonly QuotationItemRow[]) => getBlockingIssues([...rows]).map((issue) => issue.message)

// ── plan ─────────────────────────────────────────────────────────────────────

type Carry =
  | { kind: 'create'; name: string; customer: string; items: QuotationItemRow[] }
  | { kind: 'edit'; id: string; name: string; customer: string; items: QuotationItemRow[]; totals: { total: number } }
  | { kind: 'status'; id: string; to: QuotationStatus; from: QuotationStatus; viaSend: boolean }

export async function planSaveQuotation(db: Db, input: SaveQuotationInput): Promise<WritePlan<Carry>> {
  const edits = input.nombre !== undefined || input.cliente !== undefined || input.cambios !== undefined || input.lineas !== undefined
  if (!input.cotizacion) {
    if (input.cambios !== undefined || input.estado !== undefined || input.version !== undefined) {
      throw new ToolError('Para editar o cambiar el estado indica `cotizacion`; para crear manda `nombre`, `cliente` y `lineas`.')
    }
    if (input.lineas?.some((l) => l.despues_de !== undefined)) throw new ToolError('`despues_de` solo se usa al agregar líneas a una cotización existente.')
    return planCreate(db, input)
  }
  if (input.estado !== undefined) {
    if (edits) throw new ToolError('Una intención por llamada: cambiar el estado y editar líneas o encabezado van en dos llamadas, cada una con su resumen.')
    return planStatus(db, input)
  }
  if (!edits) throw new ToolError('Indica qué hacer: `cambios`, `nombre`/`cliente` o `estado`.')
  return planEdit(db, input)
}

async function planCreate(db: Db, input: SaveQuotationInput): Promise<WritePlan<Carry>> {
  const name = input.nombre?.trim() ?? ''
  const customer = input.cliente?.trim() ?? ''
  if (!name || !customer || !input.lineas?.length) throw new ToolError('Para crear indica `nombre`, `cliente` y `lineas` (al menos un producto).')

  const avisos: string[] = []
  const catalog = await catalogFor(db, input.lineas)
  const items = await buildRows(db, input.lineas, catalog, avisos)
  if (!items.some(isProductItem)) throw new ToolError('Se requiere al menos un producto.')

  for (const etm of catalog.notFound) avisos.push(`El ETM ${etm} no está en el catálogo: entra al guardar con lo que mandaste (completa código y descripción si faltan).`)
  const learn = learnWarning(items, catalog)
  if (learn) avisos.push(learn)

  const twins = await db.from('quotations').select('id').eq('name', name).eq('customer_name', customer).limit(5)
  const sameName = (twins.data ?? []) as { id: string }[]
  if (sameName.length > 0) avisos.push(`Ya hay ${sameName.length === 1 ? 'una cotización' : `${sameName.length} cotizaciones`} con ese nombre y ese cliente: esta sería otra.`)

  const bloqueos = blockMessages(items)
  const total = calculateQuotationTotal(items)
  return {
    entity: {
      key: 'cotizacion',
      value: {
        nombre: name,
        cliente: customer,
        estado: 'borrador',
        total,
        productos: items.filter(isProductItem).length,
        lineas: items.slice(0, LINES_SHOWN).map((row, i) => lineView(row, i + 1)),
      },
    },
    avisos: items.length > LINES_SHOWN ? [...avisos, `La lista muestra las primeras ${LINES_SHOWN} de ${items.length} líneas; la clave cubre todas.`] : avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    // Creating is not idempotent: a twin with the same name and customer changes this, so a repeated key finds another one.
    fingerprint: { crear: [name, customer], lineas: items.map((r) => [r.etm, r.section_label, r.quantity, r.unit_price, r.delivery_time, r.is_sold]), gemelas: sameName.map((t) => t.id) },
    subject: `La cotización «${name}»`,
    carry: { kind: 'create', name, customer, items },
  }
}

function changeSet(change: ChangeInput, status: QuotationStatus): LineSet {
  const set: LineSet = {}
  if (change.precio !== undefined) set.unit_price = change.precio
  if (change.cantidad !== undefined) set.quantity = change.cantidad
  if (change.entrega !== undefined) set.delivery_time = deliveryOf(change.entrega)
  if (change.se_vende !== undefined) set.is_sold = soldFromToken(change.se_vende)
  if (change.descripcion_dymmsa !== undefined) set.dymmsa_description = change.descripcion_dymmsa.trim()
  if (change.aprobacion !== undefined) {
    if (status === 'sent_for_approval') {
      throw new ToolError('En revisión las decisiones son del cliente y no se pueden cambiar aquí: pasa la cotización a aprobada (estado) y luego registra las líneas.')
    }
    set.is_approved = approvalFromToken(change.aprobacion)
  }
  return set
}

async function planEdit(db: Db, input: SaveQuotationInput): Promise<WritePlan<Carry>> {
  const ref = await resolveQuotation(db, input.cotizacion as string)
  const stored = await loadQuotation(db, ref.id)
  if (!EDITABLE_QUOTATION_STATUSES.includes(stored.status)) throw new ToolError(`La cotización «${stored.name}»: ${NOT_EDITABLE[stored.status] ?? 'no se puede editar en este estado.'}`)
  const version = versionOfQuotation(stored)
  if (input.version !== undefined && input.version !== version) {
    throw new ToolError(`La cotización cambió desde que la leíste (versión ${input.version}, ahora ${version}): vuelve a leerla con get_quotation y repite.`)
  }

  const original = stored.quotation_items.map(toItemRow)
  const avisos: string[] = []
  const lineChangesList: LineChange[] = []
  // `lineas` on an existing quotation are the ones to add; `despues_de` says where (original numbering).
  const adds = input.lineas ?? []
  const catalog = await catalogFor(db, adds)
  const addedRows = await buildRows(db, adds, catalog, avisos)
  addedRows.forEach((row, i) => lineChangesList.push({ kind: 'add', row, after: adds[i].despues_de }))

  for (const [index, change] of (input.cambios ?? []).entries()) {
    const where = `cambios[${index + 1}]`
    const kinds = [change.quitar === true, change.despues_de !== undefined].filter(Boolean).length
    const editsLine = [change.precio, change.cantidad, change.entrega, change.se_vende, change.aprobacion, change.descripcion_dymmsa].some((v) => v !== undefined)
    if (kinds > 1 || (kinds === 1 && editsLine)) throw new ToolError(`${where}: una operación por elemento (editar campos, quitar, o mover con despues_de).`)
    if (change.linea === undefined) throw new ToolError(`${where}: indica \`linea\` (N, [N, M] o "todas").`)
    if (change.quitar) {
      if (typeof change.linea !== 'number') throw new ToolError(`${where}: quitar va de una línea a la vez (\`linea: N\`).`)
      lineChangesList.push({ kind: 'remove', line: change.linea, guard: change.etm })
    } else if (change.despues_de !== undefined) {
      if (typeof change.linea !== 'number') throw new ToolError(`${where}: mover va de una línea a la vez (\`linea: N\`).`)
      lineChangesList.push({ kind: 'move', line: change.linea, after: change.despues_de, guard: change.etm })
    } else {
      if (!editsLine) throw new ToolError(`${where}: indica qué cambiar en la línea (precio, cantidad, entrega, se_vende, aprobacion o descripcion_dymmsa).`)
      lineChangesList.push({ kind: 'set', lines: change.linea === 'todas' ? 'all' : ([] as number[]).concat(change.linea), guard: change.etm, set: changeSet(change, stored.status) })
    }
  }

  const applied = orToolError(() => applyLineChanges(original, lineChangesList))
  const final = applied.rows
  const name = input.nombre === undefined ? stored.name : input.nombre.trim()
  const customer = input.cliente === undefined ? stored.customer_name : input.cliente.trim()
  if (!name || !customer) throw new ToolError('El nombre y el cliente no pueden quedar vacíos.')
  if (!final.some(isProductItem)) throw new ToolError('La cotización se quedaría sin productos: se requiere al menos uno.')

  // A curated text may not copy the official one (ADR-013): a line that resolves to the catalog refuses it.
  const edited = final.filter((row, i) => applied.origin[i] !== null && row.dymmsa_description !== original[(applied.origin[i] as number) - 1].dymmsa_description)
  if (edited.length > 0) {
    const official = await fetchCatalogDescriptionMap(db, edited.map((r) => r.model_code))
    for (const row of edited) {
      if (resolveDymmsaDescription({ ...row, dymmsa_description: row.dymmsa_description }, official).source === 'catalog') {
        throw new ToolError(`El ETM ${row.etm} tiene descripción oficial en el catálogo URREA y es la que se muestra: no se le puede poner una curada.`)
      }
    }
  }

  const changed = applied.origin.map((from, i) => ({ from, row: final[i] }))
  for (const { from, row } of changed) {
    if (from === null) continue
    const before = original[from - 1]
    if (isProductItem(row) && before.is_approved === true && (before.unit_price !== row.unit_price || before.quantity !== row.quantity)) {
      avisos.push(`La línea ${from} (${row.etm}) ya estaba aprobada por el cliente a $${before.unit_price} × ${before.quantity}; sigue aprobada a $${row.unit_price} × ${row.quantity}.`)
    }
    if (isProductItem(row) && before.is_sold !== row.is_sold && row.is_sold !== null) {
      avisos.push(`La línea ${from} (${row.etm}): «se_vende: ${soldToken(row.is_sold)}» se guarda también en el catálogo ETM, para todas las cotizaciones futuras.`)
    }
  }
  if (stored.status === 'approved' && addedRows.some(isProductItem)) avisos.push('En una cotización aprobada las líneas nuevas quedan pendientes: no entran a la orden hasta que alguien las apruebe.')
  if (stored.status === 'sent_for_approval') avisos.push('Está en revisión: el cliente puede tener la página abierta. Sus decisiones se conservan.')
  // Auto-learn re-reads every resent line; only the new ETMs and the changed prices are news to the catalog.
  const touched = final.filter((row, i) => isProductItem(row) && (applied.origin[i] === null || row.unit_price !== original[(applied.origin[i] as number) - 1]?.unit_price))
  const learn = learnWarning(touched, await catalogFor(db, touched.map((row) => ({ etm: row.etm }))))
  if (learn) avisos.push(learn)

  const bloqueos = blockMessages(final)
  const totalBefore = calculateQuotationTotal(original)
  const totalAfter = calculateQuotationTotal(final)
  const cambios: Record<string, { antes: unknown; ahora: unknown }> = { ...lineChanges(original, final, applied.origin, applied.moved) }
  if (name !== stored.name) cambios.nombre = { antes: stored.name, ahora: name }
  if (customer !== stored.customer_name) cambios.cliente = { antes: stored.customer_name, ahora: customer }
  const onlyApprovedBefore = calculateQuotationTotal(original, { onlyApproved: true })
  const onlyApprovedAfter = calculateQuotationTotal(final, { onlyApproved: true })
  if (totalBefore !== totalAfter) cambios.total = { antes: money(totalBefore), ahora: money(totalAfter) }
  if (onlyApprovedBefore !== onlyApprovedAfter) cambios.total_aprobado = { antes: money(onlyApprovedBefore), ahora: money(onlyApprovedAfter) }

  const nothing = Object.keys(cambios).length === 0
  return {
    entity: {
      key: 'cotizacion',
      value: { ref: refOf(stored.id), nombre: name, cliente: customer, estado: QUOTATION_STATUS_TOKENS.toToken(stored.status), total: money(totalAfter), version },
    },
    cambios,
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    sinCambios: nothing,
    // version = the line ids and updated_at: any save in between (the app, another chat) changes it.
    fingerprint: { id: stored.id, version, status: stored.status },
    subject: `La cotización «${stored.name}»`,
    carry: { kind: 'edit', id: stored.id, name, customer, items: final, totals: { total: totalAfter } },
  }
}

async function planStatus(db: Db, input: SaveQuotationInput): Promise<WritePlan<Carry>> {
  const to = QUOTATION_STATUS_TOKENS.toDb(input.estado as string)
  if (!to) throw new ToolError(`Estado inválido "${input.estado}": usa ${QUOTATION_STATUS_TOKENS.tokens.join(' | ')}`)
  if (to === 'converted_to_order') throw new ToolError('«convertida» solo se asigna al generar la orden (save_order).')
  const ref = await resolveQuotation(db, input.cotizacion as string)
  const stored = await loadQuotation(db, ref.id)
  const version = versionOfQuotation(stored)
  const items = stored.quotation_items.map(toItemRow)
  const base = {
    subject: `La cotización «${stored.name}»`,
    fingerprint: { id: stored.id, version, status: stored.status },
  }
  const entity = (state: QuotationStatus, link: string | null) => ({
    key: 'cotizacion',
    value: { ref: refOf(stored.id), nombre: stored.name, cliente: stored.customer_name, estado: QUOTATION_STATUS_TOKENS.toToken(state), total: money(calculateQuotationTotal(items)), ...(link ? { link_aprobacion: link } : {}) },
  })
  const carry: Carry = { kind: 'status', id: stored.id, to, from: stored.status, viaSend: stored.status === 'draft' && to === 'sent_for_approval' }

  if (stored.status === to) {
    return { ...base, entity: entity(to, null), avisos: [`La cotización ya está ${QUOTATION_STATUS_TOKENS.toToken(to)}.`], sinCambios: true, carry }
  }

  const bloqueos: string[] = []
  const avisos: string[] = []
  if (stored.status === 'converted_to_order' && (await linkedOrderBlocks(db, stored.id))) {
    bloqueos.push('Elimina la orden vinculada (en la app) antes de reabrir esta cotización.')
  }
  if (carry.viaSend) {
    bloqueos.push(...blockMessages(items))
    // Draft → under review is the one low-risk move: the token stays, so a link already shared keeps working.
    return { ...base, entity: entity(to, null), cambios: { estado: { antes: 'borrador', ahora: 'en_revision' } }, bloqueos: bloqueos.length > 0 ? bloqueos : undefined, directo: true, carry }
  }

  avisos.push('Cambiar el estado regenera el link de aprobación: el anterior deja de servir.')
  if (to === 'approved') {
    avisos.push(stored.approved_at ? 'Conserva la fecha de la primera aprobación.' : 'Sella la fecha de aprobación (aprobada_el) y ya no se borra.')
    if (!items.some((i) => isProductItem(i) && i.is_approved === true)) avisos.push('No hay líneas aprobadas: la orden no se podrá generar hasta aprobar alguna.')
  }
  if (to === 'sent_for_approval') avisos.push('Pasa a revisión: el cliente puede aprobar con el link nuevo; las aprobaciones que ya tenga se conservan.')
  if (to === 'rejected') avisos.push('Rechazada no se puede editar: para cambiarla hay que volver a borrador.')
  return {
    ...base,
    entity: entity(to, null),
    cambios: { estado: { antes: QUOTATION_STATUS_TOKENS.toToken(stored.status), ahora: QUOTATION_STATUS_TOKENS.toToken(to) } },
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    carry,
  }
}

// ── commit ───────────────────────────────────────────────────────────────────

export async function commitSaveQuotation(db: Db, userId: string, plan: WritePlan<Carry>) {
  const { carry } = plan
  if (carry.kind === 'create') {
    const created = await createQuotation(db, userId, { name: carry.name, customer_name: carry.customer, items: carry.items })
    const value = { ...(plan.entity.value as object), ref: refOf(created.quotation_id) }
    return writeResult('creado', 'cotizacion', value, { avisos: [...(plan.avisos ?? []), learned(created.auto_learn)] })
  }
  if (carry.kind === 'edit') {
    const updated = await updateQuotation(db, userId, carry.id, { name: carry.name, customer_name: carry.customer, items: carry.items })
    const fresh = await loadQuotation(db, carry.id)
    const value = { ...(plan.entity.value as object), total: money(updated.total_amount), version: versionOfQuotation(fresh) }
    return writeResult('actualizado', 'cotizacion', value, { cambios: plan.cambios, avisos: [...(plan.avisos ?? []), learned(updated.auto_learn)] })
  }
  const token = carry.viaSend ? (await sendForApproval(db, carry.id)).approval_token : (await setQuotationStatus(db, carry.id, carry.to)).approval_token
  const value = { ...(plan.entity.value as object), ...(carry.to === 'sent_for_approval' && token ? { link_aprobacion: approvalLink(token) } : {}) }
  return writeResult('actualizado', 'cotizacion', value, { cambios: plan.cambios, avisos: plan.avisos })
}

function learned(result: { added: number; updated: number }): string {
  return `Catálogo ETM: ${result.added} nuevo${result.added === 1 ? '' : 's'}, ${result.updated} actualizado${result.updated === 1 ? '' : 's'}.`
}
