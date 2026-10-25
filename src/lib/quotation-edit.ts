/**
 * Pure quotation editing (#155 D, ADR-041): the quoter's merge of a typed line with the ETM catalog, the stored rows
 * as the editable ones, and the line operations of save_quotation. No db, no clock: the store and the tool read and
 * write, this decides. Positions (`line`) are 1-based over ALL rows, separators included, as get_quotation numbers them.
 */

import { isNotSold } from '@/lib/business-rules'
import type { DeliveryTime, EtmProduct, QuotationItem, QuotationItemRow } from '@/types/database'

/** A stored line as the editable row (the quoter's own conversion, moved here from QuotationDetail). */
export const toItemRow = (item: QuotationItem): QuotationItemRow => ({
  _id: item.id,
  _dbId: item.id,
  item_type: item.item_type ?? 'product',
  section_label: item.section_label ?? '',
  separator_color: item.separator_color ?? null,
  etm: item.etm ?? '',
  description: item.description ?? '',
  description_es: item.description_es ?? '',
  dymmsa_description: item.dymmsa_description ?? '',
  model_code: item.model_code ?? '',
  brand: item.brand ?? '',
  unit_price: item.unit_price,
  quantity: item.quantity,
  delivery_time: item.delivery_time ?? 'immediate',
  _inDb: !!(item.model_code || item.description),
  is_approved: item.is_approved,
  is_sold: item.is_sold,
})

/** What a typed product line brings; the rest comes from the catalog. */
export interface LineDraft {
  etm: string
  quantity: number | null
  unit_price?: number | null
  delivery_time?: DeliveryTime
  is_sold?: boolean | null
  /** Only used when the ETM is not in the catalog: the catalog wins for these, as in the quoter. */
  model_code?: string
  brand?: string
  description?: string
  /** Curated DYMMSA text. */
  dymmsa_description?: string
}

/**
 * The quoter's merge (quoter/page.tsx): the catalog wins description, model code and brand; the typed line wins
 * quantity and price (the catalog price when it brings none); is_sold and the curated text are inherited.
 */
export function prefillLine(draft: LineDraft, product: Pick<EtmProduct, 'description' | 'description_es' | 'model_code' | 'brand' | 'price' | 'is_sold' | 'dymmsa_description'> | null): QuotationItemRow {
  return {
    _id: crypto.randomUUID(),
    item_type: 'product',
    section_label: '',
    separator_color: null,
    etm: draft.etm,
    description: product?.description || draft.description || '',
    description_es: product?.description_es || draft.description || '',
    model_code: product?.model_code || draft.model_code || '',
    brand: product?.brand || draft.brand || '',
    unit_price: draft.unit_price ?? product?.price ?? null,
    quantity: draft.quantity,
    delivery_time: draft.delivery_time ?? 'immediate',
    _inDb: !!product,
    is_sold: draft.is_sold !== undefined ? draft.is_sold : (product?.is_sold ?? null),
    dymmsa_description: draft.dymmsa_description ?? product?.dymmsa_description ?? '',
  }
}

export function newSeparator(label: string, color: string | null): QuotationItemRow {
  return {
    _id: crypto.randomUUID(),
    item_type: 'separator',
    section_label: label,
    separator_color: color,
    etm: '',
    description: '',
    description_es: '',
    dymmsa_description: '',
    model_code: '',
    brand: '',
    unit_price: null,
    quantity: null,
    delivery_time: 'immediate',
    _inDb: false,
  }
}

export class EditError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EditError'
  }
}

/** The fields an edit sets on product lines; absent = untouched. */
export interface LineSet {
  unit_price?: number
  quantity?: number
  delivery_time?: DeliveryTime
  is_sold?: boolean | null
  is_approved?: boolean | null
  dymmsa_description?: string
}

export type LineChange =
  /** `lines`: explicit positions or every row; `guard`: the ETM the caller thinks is there. */
  | { kind: 'set'; lines: readonly number[] | 'all'; guard?: string; set: LineSet }
  | { kind: 'remove'; line: number; guard?: string }
  /** Insert after the original line `after` (0 = first, undefined = last). */
  | { kind: 'move'; line: number; after?: number; guard?: string }
  | { kind: 'add'; row: QuotationItemRow; after?: number }

const sameEtm = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

function rowAt(rows: readonly QuotationItemRow[], line: number): QuotationItemRow {
  const row = rows[line - 1]
  if (!row) throw new EditError(`No hay línea ${line}: la cotización tiene ${rows.length}.`)
  return row
}

function checkGuard(row: QuotationItemRow, line: number, guard: string | undefined) {
  if (guard === undefined) return
  const actual = row.item_type === 'separator' ? `la sección «${row.section_label}»` : `el ETM ${row.etm}`
  if (row.item_type === 'separator' || !sameEtm(row.etm, guard)) throw new EditError(`La línea ${line} es ${actual}, no ${guard}: vuelve a leer la cotización.`)
}

/** Position of every original row after the operations, for the summary: original line → final line (null = removed). */
export interface AppliedChanges {
  rows: QuotationItemRow[]
  /** Original 1-based position of each final row; null = a new row. */
  origin: (number | null)[]
  /** Original positions of the rows moved on purpose (a row that merely shifted because another went is not here). */
  moved: Set<number>
}

/**
 * Applies the operations to the rows as they were read. Every position refers to that original numbering, so the
 * order of the operations does not matter and «la línea 5» means the same in all of them.
 */
export function applyLineChanges(original: readonly QuotationItemRow[], changes: readonly LineChange[]): AppliedChanges {
  const edited = original.map((row) => ({ ...row }))
  const removed = new Set<number>()
  const moves = new Map<number, number | undefined>()
  const adds: { row: QuotationItemRow; after?: number }[] = []

  for (const change of changes) {
    if (change.kind === 'set') {
      const lines = change.lines === 'all' ? original.map((_, i) => i + 1) : change.lines
      for (const line of lines) {
        const row = rowAt(edited, line)
        // `todas` skips the sections silently; naming one on purpose is an error.
        if (row.item_type === 'separator') {
          if (change.lines === 'all') continue
          throw new EditError(`La línea ${line} es una sección: solo los productos llevan precio, cantidad, entrega o aprobación.`)
        }
        checkGuard(row, line, change.guard)
        applySet(row, change.set, line, change.lines === 'all')
      }
    } else if (change.kind === 'remove') {
      checkGuard(rowAt(edited, change.line), change.line, change.guard)
      removed.add(change.line)
    } else if (change.kind === 'move') {
      checkGuard(rowAt(edited, change.line), change.line, change.guard)
      if (change.after !== undefined && change.after > original.length) throw new EditError(`No hay línea ${change.after}: la cotización tiene ${original.length}.`)
      if (change.after === change.line) throw new EditError(`La línea ${change.line} no puede ir después de sí misma.`)
      moves.set(change.line, change.after)
    } else {
      if (change.after !== undefined && change.after > original.length) throw new EditError(`No hay línea ${change.after}: la cotización tiene ${original.length}.`)
      adds.push({ row: change.row, after: change.after })
    }
  }

  for (const line of moves.keys()) {
    if (removed.has(line)) throw new EditError(`La línea ${line} se quita y se mueve en la misma llamada.`)
  }
  for (const after of [...moves.values(), ...adds.map((a) => a.after)]) {
    if (after !== undefined && after > 0 && removed.has(after)) throw new EditError(`La línea ${after} se quita en la misma llamada: elige otra posición.`)
  }

  // Inserts hang from an anchor (0 = the top, undefined = the bottom), in the order they were asked.
  const inserts = new Map<number | 'end', { row: QuotationItemRow; origin: number | null }[]>()
  const hang = (anchor: number | undefined, entry: { row: QuotationItemRow; origin: number | null }) => {
    const key = anchor === undefined ? 'end' : anchor
    inserts.set(key, [...(inserts.get(key) ?? []), entry])
  }
  for (const change of changes) {
    if (change.kind === 'move') hang(change.after, { row: edited[change.line - 1], origin: change.line })
    else if (change.kind === 'add') hang(change.after, { row: change.row, origin: null })
  }

  const rows: QuotationItemRow[] = []
  const origin: (number | null)[] = []
  const push = (entries: { row: QuotationItemRow; origin: number | null }[] | undefined) => {
    for (const entry of entries ?? []) {
      rows.push(entry.row)
      origin.push(entry.origin)
    }
  }
  push(inserts.get(0))
  edited.forEach((row, i) => {
    const line = i + 1
    if (!removed.has(line) && !moves.has(line)) {
      rows.push(row)
      origin.push(line)
    }
    push(inserts.get(line))
  })
  push(inserts.get('end'))
  return { rows, origin, moved: new Set(moves.keys()) }
}

/** `all` is a sweep: a «no lo vendemos» line is skipped for approval instead of failing it. */
function applySet(row: QuotationItemRow, set: LineSet, line: number, sweep: boolean) {
  if (set.unit_price !== undefined) row.unit_price = set.unit_price
  if (set.quantity !== undefined) row.quantity = set.quantity
  if (set.delivery_time !== undefined) row.delivery_time = set.delivery_time
  if (set.is_sold !== undefined) row.is_sold = set.is_sold
  if (set.is_approved !== undefined) {
    if (isNotSold(row) && set.is_approved === true) {
      if (!sweep) throw new EditError(`La línea ${line} es «no lo vendemos»: no se puede aprobar.`)
    } else row.is_approved = set.is_approved
  }
  if (set.dymmsa_description !== undefined) row.dymmsa_description = set.dymmsa_description
}
