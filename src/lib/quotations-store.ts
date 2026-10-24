/**
 * Quotation writes shared by /api/quotations/save and /update (#157), ready for the MCP's save_quotation
 * (#155 D6): one server-side validation, the create with its rollback and the edit in one DB transaction.
 */

import { DomainError } from '@/lib/domain-error'
import type { SupabaseClient } from '@supabase/supabase-js'
import { processAutoLearn, type QuotationAutoLearnResult } from '@/lib/auto-learn'
import { calculateQuotationTotal, isProductItem, resolveDymmsaDescription } from '@/lib/business-rules'
import { DELIVERY_TIME_LABELS } from '@/lib/delivery'
import { getBlockingIssues } from '@/lib/quotation-validation'
import { explainPgError, type PgErrorInput } from '@/lib/supabase-errors'
import { isUuid } from '@/lib/text'
import { fetchCatalogDescriptionMapOrNull } from '@/lib/urrea-catalog'
import type { DeliveryTime, QuotationItemRow, QuotationStatus } from '@/types/database'

/** A rule the user broke (400/404), a concurrent change (409) or a write that failed (500); base in domain-error.ts. */
export class QuotationError extends DomainError {
  constructor(
    message: string,
    kind: 'invalid' | 'not_found' | 'conflict' | 'failed' = 'invalid',
    readonly offendingEtm?: string,
    /** Machine-readable reason a client branches on (e.g. the approval page's `stale_items`). */
    readonly code?: string,
  ) {
    super(message, kind)
    this.name = 'QuotationError'
  }

  /** Response body; the ETM travels when it is known (ADR-009). */
  override get body(): { message: string; offendingEtm?: string; code?: string } {
    return {
      message: this.message,
      ...(this.offendingEtm && { offendingEtm: this.offendingEtm }),
      ...(this.code && { code: this.code }),
    }
  }
}

export const EDITABLE_QUOTATION_STATUSES: readonly QuotationStatus[] = ['draft', 'sent_for_approval', 'approved']

const NOT_EDITABLE_MESSAGE = 'Solo se pueden editar cotizaciones en borrador, en aprobación o aprobadas'
const DELIVERY_TIMES = new Set<string>(Object.keys(DELIVERY_TIME_LABELS))

export interface QuotationInput {
  name: string
  customer_name: string
  items: QuotationItemRow[]
}

/** PGRST116 = .single() found no row; anything else is a real failure, not a 404. */
function isNoRow(error: { code?: string } | null): boolean {
  return !error || error.code === 'PGRST116'
}

/** The key a DB quotation function raised on purpose (P0001), or undefined for any other error. */
export function ruleKey(error: { code?: string; message?: string }): string | undefined {
  return error.code === 'P0001' ? error.message : undefined
}

/** explainPgError → QuotationError (ADR-009); `fallback` replaces the raw DB message of a non-rule failure. */
function pgQuotationError(error: PgErrorInput | null, items: QuotationItemRow[], fallback: string): QuotationError {
  const info = explainPgError(error, items)
  if (info.isConstraintViolation) return new QuotationError(info.userMessage, 'invalid', info.offendingEtm)
  return new QuotationError(fallback, 'failed', info.offendingEtm)
}

const tagOf = (item: Record<string, unknown>) => (typeof item.etm === 'string' && item.etm) || '(sin ETM)'

/** Shape of one line: enums and numbers the DB would reject, as a Spanish message. */
function lineShapeError(item: Record<string, unknown>): string | null {
  const type = item.item_type ?? 'product'
  if (type !== 'product' && type !== 'separator') return `Tipo de línea inválido: "${String(type)}".`
  if (type === 'separator') return null
  if (item.delivery_time != null && !DELIVERY_TIMES.has(String(item.delivery_time))) {
    return `ETM "${tagOf(item)}": tiempo de entrega inválido.`
  }
  for (const field of ['unit_price', 'quantity'] as const) {
    const value = item[field]
    if (value != null && (typeof value !== 'number' || !Number.isFinite(value))) {
      return `ETM "${tagOf(item)}": ${field === 'quantity' ? 'la cantidad' : 'el precio'} debe ser un número.`
    }
  }
  for (const field of ['is_sold', 'is_approved'] as const) {
    const value = item[field]
    if (value != null && typeof value !== 'boolean') {
      return `ETM "${tagOf(item)}": ${field === 'is_sold' ? '«lo vendemos»' : 'la aprobación'} debe ser sí, no o vacío.`
    }
  }
  return null
}

/**
 * Header + lines of a save or an edit, validated on the server with the quoter's own rules
 * (quotation-validation): separators and "not sold" lines stay exempt. Throws QuotationError 400.
 */
export function parseQuotationInput(body: unknown): QuotationInput {
  const raw = (body ?? {}) as Record<string, unknown>
  const name = typeof raw.name === 'string' ? raw.name.trim() : ''
  if (!name) throw new QuotationError('El nombre de la cotización es requerido')
  const customer_name = typeof raw.customer_name === 'string' ? raw.customer_name.trim() : ''
  if (!customer_name) throw new QuotationError('El nombre del cliente es requerido')

  const rawItems = Array.isArray(raw.items) ? raw.items : []
  if (rawItems.some((item) => typeof item !== 'object' || item === null || Array.isArray(item))) {
    throw new QuotationError('Payload inválido')
  }
  if (!rawItems.some((item) => isProductItem(item as QuotationItemRow))) {
    throw new QuotationError('Se requiere al menos un producto')
  }
  for (const item of rawItems as Record<string, unknown>[]) {
    const shape = lineShapeError(item)
    if (shape) throw new QuotationError(shape, 'invalid', typeof item.etm === 'string' && item.etm ? item.etm : undefined)
  }

  const items = rawItems as QuotationItemRow[]
  const blocking = getBlockingIssues(items)
  if (blocking.length > 0) {
    const [first] = blocking
    const more = blocking.length - 1
    const suffix = more > 0 ? ` Hay ${more} problema${more !== 1 ? 's' : ''} más.` : ''
    throw new QuotationError(first.message + suffix, 'invalid', first.etm ?? undefined)
  }
  return { name, customer_name, items }
}

/** Common columns of a line as the DB stores it; the separator clears every product field. */
function lineColumns(item: QuotationItemRow, dymmsa_description: string | null, is_sold: boolean | null) {
  const isSep = item.item_type === 'separator'
  return {
    item_type:       isSep ? 'separator' : 'product',
    section_label:   isSep ? (item.section_label ?? null) : null,
    separator_color: isSep ? (item.separator_color ?? null) : null,
    etm:             isSep ? null : (item.etm || null),
    description:     isSep ? null : (item.description || null),
    description_es:  isSep ? null : (item.description_es || null),
    dymmsa_description: isSep ? null : dymmsa_description,
    model_code:      isSep ? null : (item.model_code || null),
    brand:           isSep ? null : (item.brand || null),
    unit_price:      isSep ? null : (item.unit_price ?? null),
    quantity:        isSep ? null : (item.quantity ?? null),
    delivery_time:   isSep ? null : ((item.delivery_time as DeliveryTime | undefined) ?? 'immediate'),
    is_sold:         isSep ? null : is_sold,
  }
}

/** Auto-learn never undoes a save: it runs after the write and a failure is a warning (CLAUDE.md). */
async function learn(
  db: SupabaseClient,
  userId: string,
  items: QuotationItemRow[],
  catalog: Map<string, string | null> | null,
  storedSnapshots?: Map<string, string | null>,
): Promise<{ result: QuotationAutoLearnResult | null; failed: boolean }> {
  try {
    return { result: await processAutoLearn(db, userId, items, catalog, storedSnapshots), failed: false }
  } catch (error) {
    console.error('Auto-learn failed (quotation already saved):', error)
    return { result: null, failed: true }
  }
}

// ─── Create ─────────────────────────────────────────────────────────────────

export interface CreatedQuotation {
  quotation_id: string
  total_amount: number
  items_count: number
  auto_learn: QuotationAutoLearnResult
  warning?: 'auto_learn_failed'
}

/** New draft with its lines; if the lines fail the quotation is dropped (Rollback rule). */
export async function createQuotation(db: SupabaseClient, userId: string, body: unknown): Promise<CreatedQuotation> {
  const { name, customer_name, items } = parseQuotationInput(body)
  const total_amount = calculateQuotationTotal(items)

  const { data: quotation, error: quotationError } = await db
    .from('quotations')
    .insert({ name, customer_name, status: 'draft', total_amount, created_by: userId })
    .select()
    .single()
  if (quotationError || !quotation) {
    console.error('Error creating quotation:', quotationError)
    throw new QuotationError('Error al crear la cotización', 'failed')
  }

  // Frozen snapshot of the DYMMSA description resolved server-side (catalog beats curated, ADR-013).
  const catalog = await fetchCatalogDescriptionMapOrNull(db, items.map((i) => i.model_code))
  const catalogMap = catalog ?? new Map<string, string | null>()
  const rows = items.map((item, index) => ({
    quotation_id: quotation.id as string,
    ...lineColumns(item, resolveDymmsaDescription(item, catalogMap).value, item.is_sold ?? null),
    is_approved: null,
    sort_order: index,
  }))

  const { error: itemsError } = await db.from('quotation_items').insert(rows)
  if (itemsError) {
    console.error('Error creating quotation items:', itemsError)
    const { error: rollbackError } = await db.from('quotations').delete().eq('id', quotation.id)
    if (rollbackError) console.error(`[save] rollback could not delete quotationId=${quotation.id}`, rollbackError)
    throw pgQuotationError(itemsError, items, 'Error al guardar la cotización')
  }

  const learned = await learn(db, userId, items, catalog)
  return {
    quotation_id: quotation.id as string,
    total_amount,
    items_count: items.length,
    auto_learn: learned.result ?? { added: 0, updated: 0, skipped: 0 },
    ...(learned.failed && { warning: 'auto_learn_failed' as const }),
  }
}

// ─── Edit ───────────────────────────────────────────────────────────────────

export interface UpdatedQuotation {
  quotation_id: string
  total_amount: number
  items_count: number
  warning?: 'auto_learn_failed'
}

type StoredLine = { id: string; is_approved: boolean | null; is_sold: boolean | null; dymmsa_description: string | null }

/** The id an edited line keeps: its `_dbId` (or a DB `_id`) when it is a line of this quotation; null = new. */
function keptId(item: QuotationItemRow, stored: ReadonlyMap<string, StoredLine>, taken: Set<string>): string | null {
  const key = item._dbId ?? item._id
  if (!key || !isUuid(key) || !stored.has(key) || taken.has(key)) return null
  taken.add(key)
  return key
}

/**
 * Replace-all edit in ONE transaction (update_quotation): lines keep their ids, so the client's open approval
 * page stays valid (#157). is_approved/is_sold fall back to the stored value when the UI omits them; under
 * review the DB keeps the client's is_approved. The DYMMSA description is re-resolved and frozen (ADR-013).
 */
export async function updateQuotation(
  db: SupabaseClient,
  userId: string,
  quotationId: string,
  body: unknown,
): Promise<UpdatedQuotation> {
  if (!isUuid(quotationId)) throw new QuotationError('Cotización no encontrada', 'not_found')
  const { data: quotation, error: fetchError } = await db
    .from('quotations')
    .select('id, status')
    .eq('id', quotationId)
    .single()
  if (!quotation) {
    if (isNoRow(fetchError)) throw new QuotationError('Cotización no encontrada', 'not_found')
    console.error(`[update-quotation] read error quotationId=${quotationId}`, fetchError)
    throw new QuotationError('Error al leer la cotización', 'failed')
  }
  if (!EDITABLE_QUOTATION_STATUSES.includes(quotation.status as QuotationStatus)) {
    throw new QuotationError(NOT_EDITABLE_MESSAGE)
  }

  const { name, customer_name, items } = parseQuotationInput(body)
  const total_amount = calculateQuotationTotal(items)

  // Stored values are the fallback of fields the UI omits, and the snapshots auto-learn compares against.
  const { data: storedRows, error: storedError } = await db
    .from('quotation_items')
    .select('id, is_approved, is_sold, dymmsa_description')
    .eq('quotation_id', quotationId)
    .limit(5000)
  if (storedError) {
    console.error(`[update-quotation] items read error quotationId=${quotationId}`, storedError)
    throw new QuotationError('Error al leer los productos de la cotización', 'failed')
  }
  const stored = new Map<string, StoredLine>((storedRows ?? []).map((row) => [row.id, row as StoredLine]))
  const snapshots = new Map<string, string | null>([...stored].map(([id, row]) => [id, row.dymmsa_description]))

  const catalog = await fetchCatalogDescriptionMapOrNull(db, items.map((i) => i.model_code))
  const catalogMap = catalog ?? new Map<string, string | null>()

  const taken = new Set<string>()
  const rows = items.map((item) => {
    const previous = stored.get(item._dbId ?? item._id)
    const isSep = item.item_type === 'separator'
    const is_approved = isSep ? null : item.is_approved !== undefined ? (item.is_approved ?? null) : (previous?.is_approved ?? null)
    const is_sold = item.is_sold !== undefined ? (item.is_sold ?? null) : (previous?.is_sold ?? null)
    // The curated value comes from the UI, falling back to the stored snapshot for clients that omit it.
    const curated = item.dymmsa_description !== undefined ? item.dymmsa_description : (previous?.dymmsa_description ?? null)
    const dymmsa_description = resolveDymmsaDescription({ ...item, dymmsa_description: curated }, catalogMap).value
    return { id: keptId(item, stored, taken), ...lineColumns(item, dymmsa_description, is_sold), is_approved }
  })

  const { error } = await db.rpc('update_quotation', {
    p_quotation_id: quotationId,
    p_header: { name, customer_name, total_amount },
    p_items: rows,
  })
  if (error) {
    switch (ruleKey(error)) {
      case 'quotation_not_found':
        throw new QuotationError('Cotización no encontrada', 'not_found')
      case 'quotation_not_editable':
        throw new QuotationError(NOT_EDITABLE_MESSAGE)
      case 'duplicate_item':
        throw new QuotationError('La cotización trae dos veces la misma línea. Recarga la página y vuelve a intentarlo.')
      default:
        console.error(`[update-quotation] write error quotationId=${quotationId}`, error)
        throw pgQuotationError(error, items, 'Error al actualizar la cotización')
    }
  }

  const learned = await learn(db, userId, items, catalog, snapshots)
  return {
    quotation_id: quotationId,
    total_amount,
    items_count: items.length,
    ...(learned.failed && { warning: 'auto_learn_failed' as const }),
  }
}
