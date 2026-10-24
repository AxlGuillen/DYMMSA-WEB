/** ETM product writes shared by /api/products/* and the future MCP save_product (#155 D2, #157): the
 *  ADR-013 guard runs here, not only in ProductForm, and the import follows the auto-learn rules. */

import type { SupabaseClient } from '@supabase/supabase-js'
import {
  computeNewEtmFields,
  EXISTING_ETM_COLUMNS,
  learnableDymmsaDescription,
  mergeEtmFields,
  type ExistingEtm,
  type LearnableProduct,
} from '@/lib/auto-learn'
import { normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
import { DomainError, type DomainErrorKind } from '@/lib/domain-error'
import {
  cellText,
  hasColumn,
  isBlankCell,
  listIssues,
  pick,
  sheetHeaders,
  sheetRowNumber,
  type SheetRow,
} from '@/lib/excel/sheet-rows'
import { fetchCatalogDescriptionMapOrNull } from '@/lib/urrea-catalog'
import type { EtmProduct, EtmProductUpdate, ProductImportMode, ProductImportResult } from '@/types/database'

export class ProductError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'ProductError'
  }
}

// numeric(10,2): 10^8 overflows (22003).
const PRICE_LIMIT = 100_000_000

const TEXT_FIELDS = {
  description: 'La descripción',
  description_es: 'La descripción en español',
  model_code: 'El código de modelo',
  brand: 'La marca',
} as const

/** Why a price cannot be stored, or null when it can. */
export function priceIssue(price: number): string | null {
  if (!Number.isFinite(price)) return 'El precio debe ser un número'
  if (price < 0) return 'El precio no puede ser negativo'
  if (price >= PRICE_LIMIT) return 'El precio es demasiado grande'
  return null
}

/** A create (ETM required, the rest defaulted) or a sparse edit; is_sold is tri-state, an explicit null is kept. */
export function parseProductInput(body: unknown, opts: { create: boolean }): EtmProductUpdate {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const value: EtmProductUpdate = {}

  if (raw.etm !== undefined || opts.create) {
    const etm = typeof raw.etm === 'string' ? raw.etm.trim() : ''
    if (!etm) throw new ProductError(opts.create ? 'El ETM es obligatorio' : 'El ETM no puede estar vacío')
    value.etm = etm
  }

  // TEXT NOT NULL in practice: a trimmed string, never null.
  for (const [field, label] of Object.entries(TEXT_FIELDS) as [keyof typeof TEXT_FIELDS, string][]) {
    const text = raw[field]
    if (text === undefined && !opts.create) continue
    if (text != null && typeof text !== 'string') throw new ProductError(`${label} debe ser texto`)
    value[field] = (text ?? '').trim()
  }

  if (raw.dymmsa_description !== undefined || opts.create) {
    const text = raw.dymmsa_description
    if (text != null && typeof text !== 'string') throw new ProductError('La Descripción DYMMSA debe ser texto')
    // The only nullable text column: '' is stored as null (ADR-013).
    value.dymmsa_description = (text ?? '').trim() || null
  }

  if (raw.price !== undefined || opts.create) {
    if (opts.create && raw.price == null) value.price = 0
    else {
      const issue = typeof raw.price === 'number' ? priceIssue(raw.price) : 'El precio debe ser un número'
      if (issue) throw new ProductError(issue)
      value.price = raw.price as number
    }
  }

  // Tri-state: absent leaves it alone, an explicit null IS persisted.
  if (raw.is_sold !== undefined || opts.create) {
    const sold = raw.is_sold ?? null
    if (sold !== null && typeof sold !== 'boolean') throw new ProductError('is_sold debe ser true, false o null')
    value.is_sold = sold
  }

  if (!opts.create && Object.keys(value).length === 0) throw new ProductError('No hay cambios para aplicar')
  return value
}

/**
 * ADR-013 on the server: no new copy enters through the curated field — with an official description for the
 * product's (model_code, brand) it is a 400; an unreadable catalog is a 500, never taken for "no match".
 */
export async function assertCuratedAllowed(
  db: SupabaseClient,
  product: { model_code?: string | null; brand?: string | null },
  text: string,
): Promise<void> {
  const item = { model_code: product.model_code ?? '', brand: product.brand ?? '', dymmsa_description: text }
  const catalogMap = await fetchCatalogDescriptionMapOrNull(db, [item.model_code])
  if (learnableDymmsaDescription(item, catalogMap)) return
  if (catalogMap === null) {
    throw new ProductError('No se pudo leer el catálogo URREA para revisar la Descripción DYMMSA. Intenta de nuevo.', 'failed')
  }
  throw new ProductError(
    `El código ${normalizeCatalogCode(item.model_code)} de ${normalizeCatalogBrand(item.brand)} tiene descripción oficial en el catálogo URREA y es la que se muestra: deja vacía la Descripción DYMMSA (la oficial se corrige reimportando el catálogo).`,
  )
}

export async function createProduct(db: SupabaseClient, value: EtmProductUpdate): Promise<EtmProduct> {
  // A caller that skipped parseProductInput must not insert a blank ETM.
  if (!value.etm?.trim()) throw new ProductError('El ETM es obligatorio')
  const row = {
    etm: '',
    description: '',
    description_es: '',
    dymmsa_description: null,
    model_code: '',
    brand: '',
    price: 0,
    is_sold: null,
    ...value,
  }
  if (row.dymmsa_description) await assertCuratedAllowed(db, row, row.dymmsa_description)

  const { data, error } = await db.from('etm_products').insert(row).select().single()
  if (error || !data) {
    if (error?.code === '23505') throw new ProductError(`Ya existe un producto con el ETM ${row.etm}`)
    console.error('Error creating etm_product:', error)
    throw new ProductError('Error al crear el producto', 'failed')
  }
  return data as EtmProduct
}

export async function updateProduct(db: SupabaseClient, id: string, value: EtmProductUpdate): Promise<EtmProduct> {
  const updates = { ...value }

  if (updates.dymmsa_description) {
    const { data: current, error } = await db.from('etm_products').select('*').eq('id', id).maybeSingle()
    if (error) {
      console.error('Error reading etm_product:', error)
      throw new ProductError('Error al actualizar el producto', 'failed')
    }
    if (!current) throw new ProductError('Producto no encontrado', 'not_found')
    const product = current as EtmProduct

    // A resent stored value is not an edit (ProductForm resends it when the catalog wins), as in auto-learn.
    // Changing only model_code/brand into a match keeps it too: harmless, reads prefer the official one.
    if (product.dymmsa_description && updates.dymmsa_description === product.dymmsa_description.trim()) {
      delete updates.dymmsa_description
      if (Object.keys(updates).length === 0) return product
    } else {
      await assertCuratedAllowed(
        db,
        { model_code: updates.model_code ?? product.model_code, brand: updates.brand ?? product.brand },
        updates.dymmsa_description,
      )
    }
  }

  // updated_at comes from the update_etm_products_updated_at trigger.
  const { data, error } = await db.from('etm_products').update(updates).eq('id', id).select().single()
  if (error || !data) {
    if (!error || error.code === 'PGRST116') throw new ProductError('Producto no encontrado', 'not_found')
    if (error.code === '23505') throw new ProductError('Ya existe un producto con ese ETM')
    console.error('Error updating etm_product:', error)
    throw new ProductError('Error al actualizar el producto', 'failed')
  }
  return data as EtmProduct
}

export interface ProductImportRow {
  etm: string
  description: string
  description_es: string
  model_code: string
  brand: string
  /** null = blank cell: it never overwrites the stored price. */
  price: number | null
}

// Headers match ignoring case and stray spaces (pick), as in the catalog import.
const COLUMNS = {
  etm: ['ETM'],
  description: ['DESCRIPTION'],
  description_es: ['DESCRIPTION_ES'],
  model_code: ['MODEL_CODE'],
  brand: ['BRAND'],
  price: ['PRICE'],
} as const

const REQUIRED_COLUMNS = ['etm', 'model_code'] as const

/**
 * The rows of a products file. A row without ETM is left out (`withoutEtm`, reported as an error); a bad or
 * negative price fails the whole file, listing its rows, before anything is written (#157).
 */
export function parseProductSheet(rows: readonly SheetRow[]): { rows: ProductImportRow[]; withoutEtm: number } {
  if (rows.length === 0) throw new ProductError('El archivo no contiene datos')
  const headers = sheetHeaders(rows)
  const missing = REQUIRED_COLUMNS.filter((column) => !hasColumn(headers, COLUMNS[column]))
  if (missing.length > 0) {
    throw new ProductError(`Columnas faltantes: ${missing.map((column) => COLUMNS[column][0]).join(', ')}`)
  }

  const parsed: ProductImportRow[] = []
  const issues: string[] = []
  let withoutEtm = 0

  rows.forEach((row, index) => {
    const etm = cellText(pick(row, COLUMNS.etm))
    if (!etm) {
      withoutEtm++
      return
    }
    const priceCell = pick(row, COLUMNS.price)
    let price: number | null = null
    if (!isBlankCell(priceCell)) {
      const amount = typeof priceCell === 'number' ? priceCell : Number(cellText(priceCell))
      const issue = priceIssue(amount)
      if (issue) {
        const reason = issue.charAt(0).toLowerCase() + issue.slice(1)
        issues.push(`Fila ${sheetRowNumber(row, index)} (ETM ${etm}): ${reason} («${cellText(priceCell)}»).`)
        return
      }
      price = amount
    }
    parsed.push({
      etm,
      description: cellText(pick(row, COLUMNS.description)),
      description_es: cellText(pick(row, COLUMNS.description_es)),
      model_code: cellText(pick(row, COLUMNS.model_code)),
      brand: cellText(pick(row, COLUMNS.brand)),
      price,
    })
  })

  if (issues.length > 0) throw new ProductError(listIssues('No se importó nada: corrige el archivo.', issues))
  return { rows: parsed, withoutEtm }
}

// .in() travels in the URL: chunks keep it short.
const READ_CHUNK = 200

/** An import row in auto-learn's shape: it never brings a curated description nor an is_sold. */
function asLearnable(row: ProductImportRow): LearnableProduct {
  return { ...row, unit_price: row.price, dymmsa_description: '', is_sold: null }
}

/**
 * Same rules as auto-learn (CLAUDE.md): a new ETM gets URREA only with a model_code, and an existing one only
 * takes the non-empty cells — a blank never overwrites, created_by is the creator's (#157).
 */
export async function importProducts(
  db: SupabaseClient,
  userId: string,
  rows: readonly ProductImportRow[],
  mode: ProductImportMode,
): Promise<Omit<ProductImportResult, 'total'>> {
  const result = { imported: 0, updated: 0, skipped: 0, errors: 0 }

  const existing = new Map<string, ExistingEtm>()
  const etms = [...new Set(rows.map((row) => row.etm))]
  for (let i = 0; i < etms.length; i += READ_CHUNK) {
    // oxlint-disable-next-line react-doctor/async-await-in-loop -- chunked read before any write
    const { data, error } = await db.from('etm_products').select(EXISTING_ETM_COLUMNS).in('etm', etms.slice(i, i + READ_CHUNK))
    if (error) {
      console.error('Error reading etm_products for import:', error)
      throw new ProductError('Error al leer los productos existentes; no se importó nada', 'failed')
    }
    for (const product of (Array.isArray(data) ? data : []) as ExistingEtm[]) existing.set(product.etm, product)
  }

  for (const row of rows) {
    const incoming = asLearnable(row)
    const current = existing.get(row.etm)

    if (!current) {
      const fields = computeNewEtmFields(incoming)
      // oxlint-disable-next-line react-doctor/async-await-in-loop -- sequential writes: a repeated ETM merges into the first
      const { error } = await db.from('etm_products').insert({ ...fields, created_by: userId })
      if (error) {
        console.error(`Products import insert error etm=${row.etm}:`, error)
        result.errors++
        continue
      }
      result.imported++
      existing.set(row.etm, { ...fields, brand: fields.brand ?? '' })
      continue
    }

    if (mode === 'insert') {
      result.skipped++
      continue
    }

    const { updates, hasChanges } = mergeEtmFields(current, incoming)
    if (!hasChanges) {
      result.skipped++
      continue
    }
    const { error } = await db.from('etm_products').update(updates).eq('etm', row.etm)
    if (error) {
      console.error(`Products import update error etm=${row.etm}:`, error)
      result.errors++
      continue
    }
    result.updated++
    existing.set(row.etm, { ...current, ...updates } as ExistingEtm)
  }

  return result
}
