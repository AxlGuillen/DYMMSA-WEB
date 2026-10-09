/**
 * Supplier writes shared by /api/suppliers and the MCP's save_supplier (#134): one validation,
 * the rollback of a half-created supplier and the brand links replaced by diff.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { Supplier, SupplierInsert, SupplierUpdate } from '@/types/database'

/** A rule the user broke (→ 400 / 404) or a write that failed (→ 500); routes and tools map it. */
export class SupplierError extends Error {
  constructor(message: string, readonly kind: 'invalid' | 'not_found' | 'failed' = 'invalid') {
    super(message)
    this.name = 'SupplierError'
  }
}

const CONTACT_FIELDS = ['phone', 'whatsapp', 'email', 'address', 'notes'] as const

/** A create (name required) or a sparse edit: trims, blanks become null, credit days are whole and ≥ 0. */
export function parseSupplierInput(body: unknown, opts: { requireName: boolean }): { value: SupplierUpdate } | { error: string } {
  const raw = (body ?? {}) as Record<string, unknown>
  const value: SupplierUpdate = {}
  if (raw.name !== undefined || opts.requireName) {
    const name = typeof raw.name === 'string' ? raw.name.trim() : ''
    if (!name) return { error: opts.requireName ? 'El nombre del proveedor es obligatorio' : 'El nombre del proveedor no puede quedar vacío' }
    value.name = name
  }
  for (const field of CONTACT_FIELDS) {
    if (raw[field] !== undefined) {
      const text = raw[field]
      value[field] = typeof text === 'string' ? text.trim() || null : null
    }
  }
  if (raw.payment_terms_days !== undefined) {
    const terms = raw.payment_terms_days
    if (terms != null && (typeof terms !== 'number' || !Number.isInteger(terms) || terms < 0)) {
      return { error: 'El plazo de pago debe ser un entero de días (o vacío = contado)' }
    }
    value.payment_terms_days = (terms as number | null) ?? null
  }
  return { value }
}

/** Inserts the supplier and its brand links; if the links fail the parent is dropped (no half-created record). */
export async function createSupplier(db: SupabaseClient, value: SupplierUpdate, brandIds: readonly string[] = []): Promise<Supplier> {
  if (!value.name?.trim()) throw new SupplierError('El nombre del proveedor es obligatorio')
  const payload: SupplierInsert = {
    name: value.name,
    phone: null,
    whatsapp: null,
    email: null,
    address: null,
    notes: null,
    payment_terms_days: null,
    ...value,
  }
  const { data: supplier, error } = await db.from('suppliers').insert(payload).select().single()
  if (error || !supplier) {
    if (error?.code === '23505') throw new SupplierError('Ya existe un proveedor con ese nombre')
    console.error('Error creating supplier:', error)
    throw new SupplierError('Error al crear el proveedor', 'failed')
  }

  const ids = [...new Set(brandIds)]
  if (ids.length > 0) {
    const { error: linksError } = await db
      .from('supplier_brands')
      .insert(ids.map((brand_id) => ({ supplier_id: supplier.id, brand_id })))
    if (linksError) {
      await db.from('suppliers').delete().eq('id', supplier.id)
      console.error('Error linking supplier brands (rolled back):', linksError)
      throw new SupplierError('Error al asignar las marcas del proveedor', 'failed')
    }
  }
  return supplier as Supplier
}

/** Sparse update; `brandIds` (when given) is the full desired set, applied by diff so there is never a window without links. */
export async function updateSupplier(db: SupabaseClient, id: string, value: SupplierUpdate, brandIds?: readonly string[]): Promise<void> {
  if (Object.keys(value).length === 0 && brandIds === undefined) throw new SupplierError('No hay cambios para guardar')

  // The row update doubles as the existence check (PGRST116 → 404); with only brands it never runs.
  let existenceConfirmed = false
  if (Object.keys(value).length > 0) {
    const { error } = await db.from('suppliers').update(value).eq('id', id).select('id').single()
    if (error) {
      if (error.code === 'PGRST116') throw new SupplierError('Proveedor no encontrado', 'not_found')
      if (error.code === '23505') throw new SupplierError('Ya existe un proveedor con ese nombre')
      console.error('Error updating supplier:', error)
      throw new SupplierError('Error al actualizar el proveedor', 'failed')
    }
    existenceConfirmed = true
  }
  if (brandIds === undefined) return

  // A precise 404 instead of the generic 23503 the links insert would raise.
  if (!existenceConfirmed) {
    const { data: exists, error } = await db.from('suppliers').select('id').eq('id', id).single()
    if (error || !exists) throw new SupplierError('Proveedor no encontrado', 'not_found')
  }

  const desired = [...new Set(brandIds)]
  const { data: existing, error: linksError } = await db.from('supplier_brands').select('brand_id').eq('supplier_id', id)
  if (linksError) {
    console.error('Error reading supplier brands:', linksError)
    throw new SupplierError('Error al actualizar las marcas del proveedor', 'failed')
  }

  const current = new Set(((existing ?? []) as { brand_id: string }[]).map((l) => l.brand_id))
  const toInsert = desired.filter((brandId) => !current.has(brandId))
  const toDelete = [...current].filter((brandId) => !desired.includes(brandId))

  if (toInsert.length > 0) {
    const { error } = await db.from('supplier_brands').insert(toInsert.map((brand_id) => ({ supplier_id: id, brand_id })))
    if (error) {
      console.error('Error inserting supplier brands:', error)
      throw new SupplierError('Error al asignar marcas', 'failed')
    }
  }
  if (toDelete.length > 0) {
    const { error } = await db.from('supplier_brands').delete().eq('supplier_id', id).in('brand_id', toDelete)
    if (error) {
      console.error('Error removing supplier brands:', error)
      throw new SupplierError('Error al quitar marcas', 'failed')
    }
  }
}
