/**
 * save_product (#155 D, ADR-041): create or edit one ETM product. The rules (ADR-013 guard, price, tri-state is_sold)
 * live in products-store.ts, shared with /api/products. Low-risk edits write directly; renaming the ETM or changing
 * the model code or the brand moves the catalog cross, so those ask for the yes.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, refOf, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import { resolveByName } from '@/lib/mcp/core/lookup'
import type { Db } from '@/lib/mcp/core/db'
import { catalogKey, resolveDymmsaDescription } from '@/lib/business-rules'
import {
  applyCuratedGuard,
  assertCuratedAllowed,
  createProduct,
  nextDymmsaCode,
  parseProductInput,
  updateProduct,
} from '@/lib/products-store'
import { soldFromToken, soldToken } from '@/lib/tokens'
import { fetchCatalogDescriptionMap } from '@/lib/urrea-catalog'
import type { EtmProduct, EtmProductUpdate } from '@/types/database'

export interface SaveProductInput {
  /** Exact ETM (any case), ref, or `nuevo` with `crear` for the next DYMMSA-N. */
  etm: string
  crear?: true
  nuevo_etm?: string
  descripcion?: string
  descripcion_es?: string
  descripcion_dymmsa?: string
  codigo_modelo?: string
  marca?: string
  precio?: number
  se_vende?: string
}

const NEW_ETM = 'nuevo'
const RENAME_WARNING = 'Renombrar el ETM lo desliga: la siguiente cotización con el ETM viejo crea otro producto.'
const CROSS_WARNING = 'Cambia el cruce con el catálogo URREA (descripción oficial) y la marca que el inventario le pone a ese código.'
const AUTO_BRAND_WARNING = 'Sin `marca` y con código: quedó URREA, como en el auto-aprendizaje.'

/** The one product whose ETM is exactly this (any case), or whose ref/id it is; none is an error that says how to create. */
export function resolveProduct(db: Db, reference: string): Promise<EtmProduct> {
  return resolveByName<EtmProduct>(db, {
    table: 'etm_products',
    select: '*',
    what: 'producto',
    article: 'el',
    label: (p) => p.etm,
    // Exact on purpose: `1180234` must not catch `11802345`. ilike's `_` is a wildcard, so it is checked again here.
    search: async (client, query) => {
      const { data, error } = await client.from('etm_products').select('*').ilike('etm', query).limit(6)
      if (error) throw new ToolError(`Error al buscar el producto: ${error.message}`)
      return ((data ?? []) as EtmProduct[]).filter((p) => p.etm.toLowerCase() === query.toLowerCase())
    },
    notFound: (query) => `No hay un producto con ETM "${query}" (el ETM va exacto; search_products ayuda a buscarlo). Para darlo de alta repite con \`crear: true\`.`,
  }, reference)
}

type SourceOfDescription = 'catalogo' | 'curada' | null
const SOURCES = { catalog: 'catalogo', dymmsa: 'curada' } as const

/** The product as the assistant reads it, with the DYMMSA description resolved (ADR-013). */
function present(p: EtmProduct, catalog: Map<string, string | null>) {
  const resolved = resolveDymmsaDescription({ item_type: 'product', model_code: p.model_code, brand: p.brand, dymmsa_description: p.dymmsa_description }, catalog)
  const source: SourceOfDescription = resolved.source ? SOURCES[resolved.source] : null
  return {
    ref: refOf(p.id),
    etm: p.etm,
    codigo: p.model_code,
    marca: p.brand,
    descripcion: p.description,
    descripcion_es: p.description_es,
    descripcion_dymmsa: resolved.value,
    fuente_descripcion_dymmsa: source,
    precio: p.price,
    se_vende: soldToken(p.is_sold),
  }
}

/** What an edit compares: the stored fields, with the curated text raw (the resolved one hides it behind the catalog). */
function comparable(p: Pick<EtmProduct, 'etm' | 'model_code' | 'brand' | 'description' | 'description_es' | 'dymmsa_description' | 'price' | 'is_sold'>) {
  return {
    etm: p.etm,
    codigo: p.model_code,
    marca: p.brand,
    descripcion: p.description,
    descripcion_es: p.description_es,
    descripcion_dymmsa_curada: p.dymmsa_description ?? '',
    precio: p.price,
    se_vende: soldToken(p.is_sold),
  }
}

function patchFrom(input: SaveProductInput): Record<string, unknown> {
  // The schema takes only the three tokens, so a token that maps to undefined cannot reach here.
  const sold = input.se_vende === undefined ? undefined : soldFromToken(input.se_vende)
  const raw: Record<string, unknown> = {
    description: input.descripcion,
    description_es: input.descripcion_es,
    dymmsa_description: input.descripcion_dymmsa,
    model_code: input.codigo_modelo,
    // trim+upper keeps the catalog cross (catalogKey) and the inventory view reading the same brand.
    brand: input.marca?.trim().toUpperCase(),
    price: input.precio,
    is_sold: sold,
  }
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => v !== undefined))
}

type Carry =
  | { kind: 'create'; value: EtmProductUpdate; withNextCode: boolean }
  | { kind: 'update'; product: EtmProduct; updates: EtmProductUpdate }

/** Official description for a (code, brand), for the identity-change warning. */
async function officialFor(db: Db, code: string, brand: string): Promise<string | null> {
  const map = await fetchCatalogDescriptionMap(db, [code])
  return map.get(catalogKey(code, brand)) ?? null
}

async function planCreate(db: Db, input: SaveProductInput): Promise<WritePlan<Carry>> {
  if (input.nuevo_etm !== undefined) throw new ToolError('`nuevo_etm` renombra un producto existente; al dar de alta, el ETM va en `etm`.')
  const withNextCode = input.etm.trim().toLowerCase() === NEW_ETM
  const etm = withNextCode ? `DYMMSA-${await nextDymmsaCode(db)}` : input.etm.trim()
  if (!withNextCode) {
    const existing = await resolveProduct(db, etm).catch(() => null)
    if (existing) throw new ToolError(`Ya existe el ETM ${existing.etm}: repite sin \`crear\` para editarlo.`)
  }
  const patch = patchFrom(input)
  const avisos: string[] = []
  if (patch.model_code && patch.brand === undefined) {
    patch.brand = 'URREA'
    avisos.push(AUTO_BRAND_WARNING)
  }
  // Same parser as POST /api/products: price, tri-state and text rules are not repeated here.
  const value = parseProductInput({ etm, ...patch }, { create: true })
  if (value.dymmsa_description) await assertCuratedAllowed(db, { model_code: value.model_code, brand: value.brand }, value.dymmsa_description)
  if (withNextCode) avisos.push(`Código interno asignado: ${etm}.`)

  const catalog = await fetchCatalogDescriptionMap(db, [value.model_code])
  const preview = present({ id: '00000000-0000-4000-8000-000000000000', ...value } as EtmProduct, catalog)
  return {
    // The ref of a product that does not exist yet means nothing: the answer after writing carries the real one.
    entity: { key: 'producto', value: { ...preview, ref: undefined } },
    avisos,
    directo: true,
    fingerprint: { crear: etm },
    subject: `El producto ${etm}`,
    carry: { kind: 'create', value, withNextCode },
  }
}

async function planUpdate(db: Db, input: SaveProductInput): Promise<WritePlan<Carry>> {
  const product = await resolveProduct(db, input.etm)
  const wanted = patchFrom(input)
  if (input.nuevo_etm !== undefined) wanted.etm = input.nuevo_etm
  if (Object.keys(wanted).length === 0) throw new ToolError('Indica qué cambiar (precio, se_vende, descripciones, marca, codigo_modelo o nuevo_etm).')

  // Same parser as PATCH /api/products/[id]; then only what really differs is written.
  const parsed = parseProductInput(wanted, { create: false })
  const guarded = await applyCuratedGuard(db, product, parsed)
  const updates = Object.fromEntries(Object.entries(guarded).filter(([key, value]) => (product as unknown as Record<string, unknown>)[key] !== value)) as EtmProductUpdate

  if (updates.etm) {
    const taken = await resolveProduct(db, updates.etm).catch(() => null)
    if (taken && taken.id !== product.id) throw new ToolError(`Ya existe un producto con el ETM ${updates.etm}.`)
  }

  const before = comparable(product)
  const after = comparable({ ...product, ...updates })
  const identity = updates.etm !== undefined || updates.model_code !== undefined || updates.brand !== undefined
  const avisos: string[] = []
  if (updates.etm !== undefined) avisos.push(RENAME_WARNING)
  if (updates.model_code !== undefined || updates.brand !== undefined) {
    avisos.push(CROSS_WARNING)
    const [was, will] = await Promise.all([
      officialFor(db, product.model_code, product.brand),
      officialFor(db, updates.model_code ?? product.model_code, updates.brand ?? product.brand),
    ])
    if (was !== will) avisos.push(`Descripción oficial del catálogo: ${was ? `«${was}»` : 'ninguna'} → ${will ? `«${will}»` : 'ninguna'}.`)
  }
  if (updates.is_sold === false) avisos.push('Con «no» el producto queda fuera de totales, validación y órdenes de las cotizaciones nuevas.')

  const catalog = await fetchCatalogDescriptionMap(db, [product.model_code, updates.model_code])
  return {
    entity: { key: 'producto', value: present({ ...product, ...updates }, catalog) },
    cambios: diff(before, after),
    avisos,
    sinCambios: Object.keys(updates).length === 0,
    directo: !identity,
    // Updated_at moves with the write (trigger), so a repeated key meets another fingerprint.
    fingerprint: { id: product.id, updated_at: product.updated_at, ...before },
    subject: `El producto ${product.etm}`,
    carry: { kind: 'update', product, updates },
  }
}

export function planSaveProduct(db: Db, input: SaveProductInput): Promise<WritePlan<Carry>> {
  return input.crear ? planCreate(db, input) : planUpdate(db, input)
}

/** DYMMSA-N is taken by whoever commits first: a clash is retried with the next one, a handful of times. */
const CODE_ATTEMPTS = 3

export async function commitSaveProduct(db: Db, plan: WritePlan<Carry>) {
  const { carry } = plan
  if (carry.kind === 'update') {
    const saved = await updateProduct(db, carry.product.id, carry.updates)
    const catalog = await fetchCatalogDescriptionMap(db, [saved.model_code])
    return writeResult('actualizado', 'producto', present(saved, catalog), { cambios: plan.cambios, avisos: plan.avisos })
  }

  let created: EtmProduct | null = null
  for (let attempt = 1; !created; attempt++) {
    const value = attempt === 1 || !carry.withNextCode ? carry.value : { ...carry.value, etm: `DYMMSA-${await nextDymmsaCode(db)}` }
    try {
      created = await createProduct(db, value)
    } catch (error) {
      const clash = error instanceof Error && error.message.startsWith('Ya existe un producto con el ETM')
      if (!(clash && carry.withNextCode && attempt < CODE_ATTEMPTS)) throw error
    }
  }
  const catalog = await fetchCatalogDescriptionMap(db, [created.model_code])
  return writeResult('creado', 'producto', present(created, catalog), { avisos: plan.avisos })
}

