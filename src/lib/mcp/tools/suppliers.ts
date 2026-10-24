/** Suppliers module (#21): the list, the name lookup the payables tools reuse (#109) and save_supplier (#134). */

import { ToolError } from '@/lib/mcp/core/errors'
import { listResult, refOf, writeResult } from '@/lib/mcp/core/envelope'
import { resolveByName } from '@/lib/mcp/core/lookup'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { sanitizeSearch } from '@/lib/text'
import type { Db } from '@/lib/mcp/core/db'
import { normalizeBrandTag } from '@/lib/business-rules'
import { paymentTermsLabel } from '@/lib/payables'
import { createSupplier, parseSupplierInput, updateSupplier } from '@/lib/suppliers-store'
import type { Supplier } from '@/types/database'

type SupplierRow = Supplier & { supplier_brands: { brands: { name: string } | null }[] | null }

const SELECT = '*, supplier_brands(brands(name))'

function digest(row: SupplierRow) {
  return {
    ref: refOf(row.id),
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
  pagina?: number
  por_pagina?: number
}

// With a brand filter the cut happens AFTER filtering in JS, so the read is wide on purpose.
const BRAND_SCAN_LIMIT = 1000

export async function listSuppliers(db: Db, input: ListSuppliersInput = {}) {
  const { pagina, por_pagina, from, to } = normalizePagination(input, 50)
  const search = sanitizeSearch(input.buscar ?? '')
  const brand = (input.marca ?? '').trim().toUpperCase()
  let query = db.from('suppliers').select(SELECT, { count: 'exact' }).order('name', { ascending: true })
  query = brand ? query.limit(BRAND_SCAN_LIMIT) : query.range(from, to)
  if (search) {
    query = query.or(
      `name.ilike.%${search}%,phone.ilike.%${search}%,whatsapp.ilike.%${search}%,email.ilike.%${search}%`,
    )
  }
  const { data, error, count } = await query
  if (error) throw new ToolError(`Error al leer proveedores: ${error.message}`)

  const rows = (data ?? []) as SupplierRow[]
  if (!brand) return listResult('proveedores', rows.map(digest), { total: count ?? rows.length, pagina, por_pagina })

  const matching = rows.map(digest).filter((s) => s.marcas.some((m) => m.includes(brand)))
  const scanCut = rows.length >= BRAND_SCAN_LIMIT
  return listResult(
    'proveedores',
    matching.slice(from, to + 1),
    { total: matching.length, pagina, por_pagina },
    scanCut ? `Se revisaron solo los primeros ${BRAND_SCAN_LIMIT} proveedores: puede haber más con esa marca.` : undefined,
  )
}

export type SupplierRef = Pick<Supplier, 'id' | 'name' | 'payment_terms_days'>

/** The one supplier whose ref or name matches; with several matches the error lists them. */
export function resolveSupplier(db: Db, reference: string): Promise<SupplierRef> {
  return resolveByName<SupplierRef>(db, {
    table: 'suppliers',
    select: 'id, name, payment_terms_days',
    what: 'proveedor',
    article: 'el',
    label: (s) => s.name,
    nameColumns: ['name'],
  }, reference)
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

  if (!editing) {
    const created = await createSupplier(db, parsed.value, add)
    return writeResult('creado', 'proveedor', await readSupplier(db, created.id))
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
  // Already the write envelope (#155 C3): it only gains escrito.
  return writeResult('actualizado', 'proveedor', await readSupplier(db, target.id))
}
