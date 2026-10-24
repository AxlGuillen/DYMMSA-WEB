/** URREA catalog writes shared by /api/urrea-catalog/* and the future MCP save_urrea_catalog_item (#155 D3, #157);
 *  reads stay in urrea-catalog.ts. */

import type { SupabaseClient } from '@supabase/supabase-js'
import { catalogKey, normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
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
import type {
  CatalogImportMode,
  UrreaCatalogInsert,
  UrreaCatalogItem,
  UrreaCatalogUpdate,
} from '@/types/database'

export class CatalogError extends DomainError {
  constructor(message: string, kind: DomainErrorKind = 'invalid') {
    super(message, kind)
    this.name = 'CatalogError'
  }
}

export const STD_MESSAGE = 'STD debe ser un entero mayor que 0'
const DUPLICATE_MESSAGE = 'Ya existe un producto con ese código y marca'
const INT_MAX = 2_147_483_647

const CODE_ALIASES = ['codigo', 'código', 'code']
const BRAND_ALIASES = ['marca', 'brand']
const DESCRIPTION_ALIASES = ['descripcion', 'descripción', 'description']
const STD_ALIASES = ['std']

/** A whole number > 0 from a JSON number or a spreadsheet cell; null = not one (2.5, 0, -1, "abc"). */
export function toStd(value: unknown): number | null {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value.trim()) : NaN
  return Number.isInteger(n) && n > 0 && n <= INT_MAX ? n : null
}

function optionalText(raw: Record<string, unknown>, field: string, label: string): string | null | undefined {
  const value = raw[field]
  if (value === undefined) return undefined
  if (value !== null && typeof value !== 'string') throw new CatalogError(`${label} debe ser texto`)
  return value
}

/** A row ready to insert: normalized, non-empty code and a whole STD > 0. */
export interface NewCatalogItem {
  code: string
  brand: string
  description: string | null
  std: number
}

/** A create (code required, STD 1 when blank) or a sparse edit; everything normalized as the cross needs it. */
export function parseCatalogItemInput(body: unknown, opts: { create: true }): NewCatalogItem
export function parseCatalogItemInput(body: unknown, opts: { create: false }): UrreaCatalogUpdate
export function parseCatalogItemInput(body: unknown, opts: { create: boolean }): NewCatalogItem | UrreaCatalogUpdate {
  const raw = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>
  const value: UrreaCatalogUpdate = opts.create ? { description: null } : {}

  const code = optionalText(raw, 'code', 'El código')
  if (code !== undefined || opts.create) {
    // Join key against model_code for the DYMMSA description (ADR-013).
    const normalized = normalizeCatalogCode(code)
    if (!normalized) throw new CatalogError(opts.create ? 'El código es obligatorio' : 'El código no puede estar vacío')
    value.code = normalized
  }

  const brand = optionalText(raw, 'brand', 'La marca')
  if (brand !== undefined || opts.create) value.brand = normalizeCatalogBrand(brand)

  const description = optionalText(raw, 'description', 'La descripción')
  if (description !== undefined) value.description = description?.trim() || null

  if (raw.std !== undefined || opts.create) {
    if (opts.create && isBlankCell(raw.std)) value.std = 1
    else {
      const std = toStd(raw.std)
      if (std === null) throw new CatalogError(STD_MESSAGE)
      value.std = std
    }
  }

  if (!opts.create && Object.keys(value).length === 0) throw new CatalogError('No hay cambios para aplicar')
  return value
}

function writeError(error: { code?: string } | null, fallback: string): CatalogError {
  if (error?.code === '23505') return new CatalogError(DUPLICATE_MESSAGE)
  if (error?.code === '23514') return new CatalogError(STD_MESSAGE)
  return new CatalogError(fallback, 'failed')
}

/** Takes a parsed row and re-checks it, so a caller that skipped the parser cannot insert a blank code. */
export async function createCatalogItem(db: SupabaseClient, item: NewCatalogItem): Promise<UrreaCatalogItem> {
  const code = normalizeCatalogCode(item.code)
  if (!code) throw new CatalogError('El código es obligatorio')
  const std = toStd(item.std)
  if (std === null) throw new CatalogError(STD_MESSAGE)
  const payload: UrreaCatalogInsert = {
    code,
    brand: normalizeCatalogBrand(item.brand),
    description: item.description?.trim() || null,
    std,
  }
  const { data, error } = await db.from('urrea_catalog').insert(payload).select().single()
  if (error || !data) {
    if (error?.code !== '23505') console.error('Error creating urrea_catalog item:', error)
    throw writeError(error, 'Error al crear el producto')
  }
  return data as UrreaCatalogItem
}

export async function updateCatalogItem(db: SupabaseClient, id: string, value: UrreaCatalogUpdate): Promise<UrreaCatalogItem> {
  const { data, error } = await db.from('urrea_catalog').update(value).eq('id', id).select().single()
  if (error || !data) {
    if (!error || error.code === 'PGRST116') throw new CatalogError('Producto no encontrado', 'not_found')
    if (error.code !== '23505') console.error('Error updating urrea_catalog item:', error)
    throw writeError(error, 'Error al actualizar el producto')
  }
  return data as UrreaCatalogItem
}

export interface CatalogSheet {
  rows: NewCatalogItem[]
  /** Columns the file carries: an upsert leaves the stored value of a missing one alone (#157, ADR-018 STD). */
  columns: { description: boolean; std: boolean }
}

/**
 * The rows of a catalog file, normalized, or a CatalogError that lists every offending row: a blank code, a
 * repeated (code, brand) or an STD that is not a whole number > 0. Nothing is written with a bad file (#157).
 */
export function parseCatalogSheet(rows: readonly SheetRow[]): CatalogSheet {
  if (rows.length === 0) throw new CatalogError('El archivo no contiene datos')
  const headers = sheetHeaders(rows)
  if (!hasColumn(headers, CODE_ALIASES)) throw new CatalogError('Columna faltante: codigo (o code)')

  const parsed: NewCatalogItem[] = []
  const issues: string[] = []
  const seen = new Map<string, { code: string; brand: string; at: number[] }>()

  rows.forEach((row, index) => {
    const at = sheetRowNumber(row, index)
    const code = normalizeCatalogCode(cellText(pick(row, CODE_ALIASES)))
    const brand = normalizeCatalogBrand(cellText(pick(row, BRAND_ALIASES)))
    const stdCell = pick(row, STD_ALIASES)
    // A blank STD is the column default; a written one must be valid.
    const std = stdCell === undefined ? 1 : toStd(stdCell)

    if (!code) issues.push(`Fila ${at}: falta el código.`)
    if (std === null) issues.push(`Fila ${at}: el STD «${cellText(stdCell)}» no es un entero mayor que 0.`)
    if (!code || std === null) return

    const key = catalogKey(code, brand)
    const entry = seen.get(key) ?? { code, brand, at: [] }
    entry.at.push(at)
    seen.set(key, entry)
    parsed.push({ code, brand, description: cellText(pick(row, DESCRIPTION_ALIASES)) || null, std })
  })

  for (const { code, brand, at } of seen.values()) {
    if (at.length > 1) issues.push(`Filas ${at.join(', ')}: el código ${code} de ${brand} está repetido.`)
  }

  if (issues.length > 0) throw new CatalogError(listIssues('No se importó nada: corrige el archivo.', issues))
  return {
    rows: parsed,
    columns: { description: hasColumn(headers, DESCRIPTION_ALIASES), std: hasColumn(headers, STD_ALIASES) },
  }
}

/** P0001 keys of replace_urrea_catalog and the other errors of a whole-file write, as a CatalogError. */
function importError(error: { code?: string; message?: string }, mode: CatalogImportMode): CatalogError {
  if (error.code === 'P0001' && error.message === 'empty_catalog') return new CatalogError('El archivo no contiene datos')
  if (error.code === 'P0001' && error.message === 'empty_code') return new CatalogError('Hay filas sin código: no se importó nada')
  if (error.code === '23505' || error.code === '21000') return new CatalogError('Hay códigos repetidos con la misma marca: no se importó nada')
  if (error.code === '23514' || error.code === '22P02') return new CatalogError(`${STD_MESSAGE}: no se importó nada`)
  console.error(`Error importing urrea_catalog (${mode}):`, error)
  return new CatalogError(
    mode === 'replace' ? 'Error al reemplazar el catálogo; quedó como estaba' : 'Error al importar el catálogo; no se guardó nada',
    'failed',
  )
}

/** `replace` swaps the whole catalog in one DB transaction (replace_urrea_catalog); `upsert` is one statement. */
export async function importCatalog(
  db: SupabaseClient,
  { rows, columns }: CatalogSheet,
  mode: CatalogImportMode,
): Promise<{ imported: number }> {
  if (rows.length === 0) throw new CatalogError('No hay filas válidas en el archivo')

  // A full catalog: a missing column takes its defaults.
  if (mode === 'replace') {
    const { data, error } = await db.rpc('replace_urrea_catalog', { p_rows: rows })
    if (error) throw importError(error, mode)
    return { imported: typeof data === 'number' ? data : rows.length }
  }

  // PostgREST only sets the columns present in the payload: a file without `std` keeps every stored STD.
  const payload = rows.map(({ code, brand, description, std }) => ({
    code,
    brand,
    ...(columns.description && { description }),
    ...(columns.std && { std }),
  }))
  // (code, brand) is the catalog identity; the file was checked for repeats, so one row is never hit twice.
  const { error } = await db.from('urrea_catalog').upsert(payload, { onConflict: 'code,brand' })
  if (error) throw importError(error, mode)
  return { imported: rows.length }
}
