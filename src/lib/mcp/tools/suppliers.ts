/** Suppliers module (#21), read-only — plus the name lookup the payables tools reuse (#109). */

import { ToolError, requireSingleMatch, sanitizeSearch, type Db } from '../shared'
import { paymentTermsLabel } from '@/lib/payables'
import type { Supplier } from '@/types/database'

type SupplierRow = Supplier & { supplier_brands: { brands: { name: string } | null }[] | null }

const SELECT = '*, supplier_brands(brands(name))'

function digest(row: SupplierRow) {
  return {
    id: row.id,
    nombre: row.name,
    telefono: row.phone,
    whatsapp: row.whatsapp,
    email: row.email,
    direccion: row.address,
    plazo_pago: paymentTermsLabel(row.payment_terms_days),
    dias_credito: row.payment_terms_days,
    marcas: (row.supplier_brands ?? [])
      .map((link) => link.brands?.name)
      .filter((name): name is string => Boolean(name))
      .sort(),
    notas: row.notes,
  }
}

export interface ListSuppliersInput {
  buscar?: string
  marca?: string
  limit?: number
}

export async function listSuppliers(db: Db, input: ListSuppliersInput = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const search = sanitizeSearch(input.buscar ?? '')
  let query = db.from('suppliers').select(SELECT).order('name', { ascending: true }).limit(limit)
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`,
    )
  }
  const { data, error } = await query
  if (error) throw new ToolError(`Error al leer proveedores: ${error.message}`)

  // Brand filter in JS: suppliers are few and the embed already carries their brands.
  const brand = (input.marca ?? '').trim().toUpperCase()
  const rows = ((data ?? []) as SupplierRow[])
    .map(digest)
    .filter((s) => !brand || s.marcas.some((m) => m.includes(brand)))
  return { total: rows.length, proveedores: rows }
}

export type SupplierRef = Pick<Supplier, 'id' | 'name' | 'payment_terms_days'>

/** The one supplier whose name contains `name`; with several matches the error lists them. */
export async function resolveSupplier(db: Db, name: string): Promise<SupplierRef> {
  const query = sanitizeSearch(name)
  if (!query) throw new ToolError('Indica el nombre del proveedor')
  const { data, error } = await db
    .from('suppliers')
    .select('id, name, payment_terms_days')
    .ilike('name', `%${query}%`)
    .limit(6)
  if (error) throw new ToolError(`Error al buscar el proveedor: ${error.message}`)
  return requireSingleMatch((data ?? []) as SupplierRef[], (s) => s.name, 'proveedor', query)
}
