/** Suppliers module (#21): the list, the name lookup the payables tools reuse (#109) and save_supplier (#134). */

import { ToolError, requireSingleMatch, sanitizeSearch, type Db } from '../shared'
import { normalizeBrandTag } from '@/lib/business-rules'
import { paymentTermsLabel } from '@/lib/payables'
import { createSupplier, parseSupplierInput, SupplierError, updateSupplier } from '@/lib/suppliers-store'
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

// With a brand filter the cut happens AFTER filtering in JS, so the read is wide on purpose.
const BRAND_SCAN_LIMIT = 1000

export async function listSuppliers(db: Db, input: ListSuppliersInput = {}) {
  const limit = Math.min(100, Math.max(1, Math.floor(input.limit ?? 50)))
  const search = sanitizeSearch(input.buscar ?? '')
  const brand = (input.marca ?? '').trim().toUpperCase()
  let query = db
    .from('suppliers')
    .select(SELECT)
    .order('name', { ascending: true })
    .limit(brand ? BRAND_SCAN_LIMIT : limit)
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`,
    )
  }
  const { data, error } = await query
  if (error) throw new ToolError(`Error al leer proveedores: ${error.message}`)

  const rows = (data ?? []) as SupplierRow[]
  const matching = rows.map(digest).filter((s) => !brand || s.marcas.some((m) => m.includes(brand)))
  const scanCut = Boolean(brand) && rows.length >= BRAND_SCAN_LIMIT
  return {
    total: matching.length,
    mostrados: Math.min(matching.length, limit),
    nota: scanCut ? `Se revisaron solo los primeros ${BRAND_SCAN_LIMIT} proveedores: puede haber más con esa marca.` : null,
    proveedores: matching.slice(0, limit),
  }
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

export interface SaveSupplierInput {
  /** The supplier to edit (name or part of it); absent = a new one. */
  proveedor?: string
  nombre?: string
  telefono?: string
  whatsapp?: string
  email?: string
  direccion?: string
  notas?: string
  /** Credit days; null = cash. */
  dias_credito?: number | null
  agregar_marcas?: string[]
  quitar_marcas?: string[]
}

/** Brand names → ids. An unknown one is an error that lists the catalog: a typo must not mint a brand (#134). */
async function brandIdsFor(db: Db, ...lists: (readonly string[] | undefined)[]): Promise<string[][]> {
  if (lists.every((l) => !l?.length)) return lists.map(() => [])
  const { data, error } = await db.from('brands').select('id, name').order('name', { ascending: true })
  if (error) throw new ToolError(`Error al leer las marcas: ${error.message}`)
  const byName = new Map(((data ?? []) as { id: string; name: string }[]).map((b) => [b.name, b.id]))
  const wanted = lists.map((l) => [...new Set((l ?? []).map(normalizeBrandTag).filter(Boolean))])
  const missing = [...new Set(wanted.flat().filter((name) => !byName.has(name)))]
  if (missing.length > 0) {
    const known = [...byName.keys()].join(', ') || 'ninguna'
    throw new ToolError(`No existe la marca ${missing.join(', ')}. Marcas registradas: ${known}. Una marca nueva se da de alta en la app (Proveedores → Marcas).`)
  }
  return wanted.map((names) => names.map((name) => byName.get(name) as string))
}

async function readSupplier(db: Db, id: string) {
  const { data, error } = await db.from('suppliers').select(SELECT).eq('id', id).single()
  if (error || !data) throw new ToolError('El proveedor se guardó, pero no se pudo leer de vuelta')
  return digest(data as SupplierRow)
}

/** Creates or edits a supplier with the same rules as POST/PATCH /api/suppliers; never deletes one. */
export async function saveSupplier(db: Db, input: SaveSupplierInput) {
  const fields: Record<string, unknown> = {
    name: input.nombre,
    phone: input.telefono,
    whatsapp: input.whatsapp,
    email: input.email,
    address: input.direccion,
    notes: input.notas,
    payment_terms_days: input.dias_credito,
  }
  const body = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined))
  const editing = Boolean(input.proveedor?.trim())
  const parsed = parseSupplierInput(body, { requireName: !editing })
  if ('error' in parsed) throw new ToolError(parsed.error)
  if (!editing && input.quitar_marcas?.length) {
    throw new ToolError('Un proveedor nuevo no tiene marcas que quitar: en el alta manda solo agregar_marcas.')
  }
  const [add, remove] = await brandIdsFor(db, input.agregar_marcas, input.quitar_marcas)

  try {
    if (!editing) {
      const created = await createSupplier(db, parsed.value, add)
      return { accion: 'creado', proveedor: await readSupplier(db, created.id) }
    }
    const target = await resolveSupplier(db, input.proveedor as string)
    let brandIds: string[] | undefined
    if (add.length > 0 || remove.length > 0) {
      const { data, error } = await db.from('supplier_brands').select('brand_id').eq('supplier_id', target.id)
      if (error) throw new ToolError(`Error al leer las marcas del proveedor: ${error.message}`)
      const current = new Set(((data ?? []) as { brand_id: string }[]).map((l) => l.brand_id))
      add.forEach((id) => current.add(id))
      remove.forEach((id) => current.delete(id))
      brandIds = [...current]
    }
    await updateSupplier(db, target.id, parsed.value, brandIds)
    return { accion: 'actualizado', proveedor: await readSupplier(db, target.id) }
  } catch (error) {
    if (error instanceof SupplierError) throw new ToolError(error.message)
    throw error
  }
}
