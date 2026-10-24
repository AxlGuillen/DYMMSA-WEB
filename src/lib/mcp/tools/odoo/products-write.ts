/**
 * odoo_save_product (#144, #154, ADR-040): creates the preview's new goods, or gives the existing ones
 * their missing SAT key — only from the view's button, whose authorization rides in _meta. Never twice.
 */

import { z } from 'zod'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { OdooError } from '@/lib/odoo/client'
import { startDeadline, type Deadline } from '@/lib/odoo/deadline'
import { escapeLike, orDomain } from '@/lib/odoo/domains'
import { odooWriteEnv } from '@/lib/odoo/env'
import {
  PRODUCTS_CHANGED_MESSAGE,
  PRODUCTS_UNAUTHORIZED_MESSAGE,
  verifyProductsAuthorization,
  type ProductsKeyClaims,
} from '@/lib/odoo/preview-token'
import {
  LINE_PRICE_MAX,
  MAX_NEW_PRODUCTS,
  MAX_SAT_ASSIGN,
  productName,
  splitEtm,
  type ProductForCreation,
} from '@/lib/odoo/quotation-plan'
import { SAT_PLACEHOLDER } from '@/lib/odoo/sat-keys'
import { ETM_CODE_LIST, type ProductCreateVals } from '@/lib/odoo/write-catalog'
import type { AdminProof } from '@/lib/odoo/write-guard'
import type { McpContext } from '../../core/context'
import { fold } from '@/lib/text'
import { requireLiveAdmin } from '@/lib/mcp/core/auth/live-admin'
import { ToolError } from '@/lib/mcp/core/errors'
import { parseInput, withSample, type InputOf } from '@/lib/mcp/core/schema'
import type { OdooQuotationDeps } from './quotations'
import { isId, many2oneName, rowsOf } from './resolve'

export { SAT_PLACEHOLDER } from '@/lib/odoo/sat-keys'

type ToolContext = Pick<McpContext, 'db' | 'userId' | 'role'>

const satKey = z.string().regex(/^\d{8}$/, 'clave SAT de 8 dígitos')

// Mirrors ProductForCreation (quotation-plan.ts) plus the admin's choice of key in the view (#154).
const productForCreation = z.strictObject({
  codigo: z.string().min(1).max(40),
  descripcion: z.string().min(1).max(200),
  marca: z.string().min(1).max(40).optional(),
  etm: z.string().regex(ETM_CODE_LIST, 'ETM de 9 dígitos (o varios separados por comas)').optional(),
  precio: z.number().min(0).max(LINE_PRICE_MAX),
  clave_sat: satKey.optional(),
  clave_sat_tecleada: z.boolean().optional(),
})

const satAssignment = z.strictObject({
  producto_id: z.number().int().positive(),
  clave_sat: satKey,
  clave_sat_tecleada: z.boolean().optional(),
})

export const saveProductShape = {
  productos: z.array(productForCreation).min(1).max(MAX_NEW_PRODUCTS).optional().describe('Alta: productos_para_alta con su clave elegida'),
  asignar: z.array(satAssignment).min(1).max(MAX_SAT_ASSIGN).optional().describe('Clave SAT de productos que ya existen'),
  autorizacion: withSample(z.string().min(1).max(8000), '<la autorización de la vista previa>').describe('La de la vista previa'),
}

export type SaveProductInput = InputOf<typeof saveProductShape>

export interface SavedProduct {
  readonly id: number
  readonly nombre: string
}

/** odoo_save_product's alta result; the view reports it in its one updateModelContext. */
export interface ProductsSaveResult {
  readonly creados: readonly SavedProduct[]
  readonly ya_existian: readonly SavedProduct[]
  /** Created without a SAT key: they can't be stamped until it is captured in Odoo. */
  readonly sin_clave_sat: number
}

export interface KeyedProduct extends SavedProduct {
  readonly clave_sat: string
}

/** Already keyed in Odoo; clave_sat null when Odoo has one but sent no name for it. */
export interface AlreadyKeyedProduct extends SavedProduct {
  readonly clave_sat: string | null
}

/** The assign result (#154): a key someone captured in Odoo since the preview is reported, never replaced. */
export interface SatAssignResult {
  readonly asignados: readonly KeyedProduct[]
  readonly ya_tenian: readonly AlreadyKeyedProduct[]
}

/** What a refusal says was left undone: the alta keeps its messages word for word (#154). */
interface Undone {
  readonly nothing: string
  readonly where: string
}

const ALTA: Undone = { nothing: 'No se creó nada.', where: 'da de alta el producto ahí' }
const ASSIGN: Undone = { nothing: 'No se asignó ninguna clave.', where: 'asígnala ahí' }

const lowerFirst = (text: string) => text.charAt(0).toLowerCase() + text.slice(1)

const ONE_MODE = 'Manda productos (alta) o asignar (clave SAT de productos que ya existen), no los dos. No se escribió nada.'

interface KeyChoice {
  readonly clave_sat?: string
  readonly clave_sat_tecleada?: boolean
}

/**
 * A key the preview did not offer passes only if marked as typed. clave_sat_tecleada travels unsigned by design, so ks
 * only catches view mistakes; the real locks are a (which products) and the catalog lookup before writing.
 */
function assertOffered(choice: KeyChoice, offered: readonly string[] | undefined): void {
  if (choice.clave_sat && choice.clave_sat_tecleada !== true && !offered?.includes(choice.clave_sat)) {
    throw new ToolError(PRODUCTS_CHANGED_MESSAGE)
  }
}

interface PlannedProduct {
  readonly product: ProductForCreation
  /** productName(): the name it gets in Odoo and the one searched for. */
  readonly name: string
  readonly etm: readonly string[]
}

function planProducts(products: readonly ProductForCreation[]): PlannedProduct[] {
  const seen = new Map<string, number>()
  return products.map((product, index) => {
    const name = productName(product.codigo, product.descripcion, product.marca)
    const twin = seen.get(fold(name))
    if (twin !== undefined) {
      throw new ToolError(`Los productos ${twin + 1} y ${index + 1} se llamarían igual («${name}»): no se creó nada.`)
    }
    seen.set(fold(name), index)
    return { product, name, etm: splitEtm(product.etm) }
  })
}

interface ExistingRow {
  readonly id: number
  readonly name: string
  readonly etm: readonly string[]
}

const TOO_MANY =
  'Hay demasiadas coincidencias en Odoo para estos productos: no se creó nada. Revisa en Odoo si ya existen y vuelve a pedir la vista previa.'

/** ONE search, archived included: an exact name or every ETM code already there means it exists. */
async function findExisting(
  reader: OdooQuotationDeps['reader'],
  planned: readonly PlannedProduct[],
): Promise<Map<number, SavedProduct>> {
  const conditions: DomainTriple[] = []
  const seen = new Set<string>()
  const add = (condition: DomainTriple) => {
    const key = JSON.stringify(condition)
    if (!seen.has(key)) {
      seen.add(key)
      conditions.push(condition)
    }
  }
  for (const p of planned) {
    add(['name', '=ilike', escapeLike(p.name)])
    for (const code of p.etm) add(['default_code', 'ilike', escapeLike(code)])
  }
  const limit = Math.min(planned.length * 6 + 50, 400)
  const rows: ExistingRow[] = rowsOf(
    await reader('product.product', 'search_read', {
      domain: orDomain(conditions),
      fields: ['name', 'default_code'],
      limit,
      order: 'id asc',
      context: { active_test: false },
    }),
  ).map((row) => {
    if (!isId(row.id) || typeof row.name !== 'string') {
      throw new OdooError('Odoo devolvió un producto que no pude leer: no se creó nada.')
    }
    return { id: row.id, name: row.name, etm: splitEtm(typeof row.default_code === 'string' ? row.default_code : null) }
  })
  // A cut-off answer could hide the very product a retry is looking for.
  if (rows.length >= limit) throw new ToolError(TOO_MANY)

  const existing = new Map<number, SavedProduct>()
  for (const [index, p] of planned.entries()) {
    const byName = rows.find((row) => fold(row.name) === fold(p.name))
    const byEtm = p.etm.length > 0 ? rows.find((row) => p.etm.every((code) => row.etm.includes(code))) : undefined
    const found = byName ?? byEtm
    if (found) existing.set(index, { id: found.id, nombre: found.name })
  }
  return existing
}

/** Every SAT key to write, in ONE search by code; a missing or placeholder key stops before writing. */
async function resolveSatKeys(
  reader: OdooQuotationDeps['reader'],
  wanted: readonly (string | undefined)[],
  undone: Undone,
): Promise<Map<string, number>> {
  const codes = [...new Set(wanted.flatMap((code) => (code ? [code] : [])))]
  if (codes.includes(SAT_PLACEHOLDER)) {
    throw new ToolError(
      `La clave SAT ${SAT_PLACEHOLDER} significa «no existe en el catálogo»: usa la clave real o quítala (se captura después en Odoo). ${undone.nothing}`,
    )
  }
  if (codes.length === 0) return new Map()

  const found = new Map<string, number[]>()
  const rows = rowsOf(
    await reader('product.unspsc.code', 'search_read', {
      domain: [['code', 'in', codes]],
      fields: ['code'],
      limit: codes.length * 2 + 1,
      // product_unspsc can load real SAT keys archived; Odoo still accepts them on a product.
      context: { active_test: false },
    }),
  )
  for (const row of rows) {
    if (!isId(row.id) || typeof row.code !== 'string') {
      throw new OdooError(`Odoo devolvió una clave SAT que no pude leer: ${lowerFirst(undone.nothing)}`)
    }
    found.set(row.code, [...(found.get(row.code) ?? []), row.id])
  }
  const missing = codes.filter((code) => !found.has(code))
  if (missing.length > 0) {
    const one = missing.length === 1
    throw new ToolError(
      `${one ? 'La clave SAT' : 'Las claves SAT'} ${missing.join(', ')} no ${one ? 'existe' : 'existen'} en el catálogo del SAT de Odoo: corrígela${one ? '' : 's'} o quítala${one ? '' : 's'} y vuelve a pedir la vista previa. ${undone.nothing}`,
    )
  }
  const repeated = codes.find((code) => (found.get(code) ?? []).length > 1)
  if (repeated) throw new ToolError(`La clave SAT ${repeated} aparece más de una vez en Odoo: ${undone.where}. ${undone.nothing}`)
  return new Map(codes.map((code) => [code, (found.get(code) ?? [])[0]]))
}

function createVals(p: PlannedProduct, satIds: ReadonlyMap<string, number>): ProductCreateVals {
  const satId = p.product.clave_sat ? satIds.get(p.product.clave_sat) : undefined
  if (p.product.clave_sat && satId === undefined) throw new OdooError('No pude resolver la clave SAT: no se creó nada.')
  // Goods only, with the instance defaults (invoice on delivery, IVA 16, Unidades): decision 4b.
  return {
    name: p.name,
    ...(p.product.etm ? { default_code: p.product.etm } : {}),
    list_price: p.product.precio,
    type: 'consu',
    sale_ok: true,
    ...(satId !== undefined ? { unspsc_code_id: satId } : {}),
  }
}

async function createProducts(
  deps: OdooQuotationDeps,
  proof: AdminProof,
  claims: ProductsKeyClaims,
  products: readonly (ProductForCreation & KeyChoice)[],
  dl: Deadline,
): Promise<ProductsSaveResult> {
  products.forEach((product, index) => assertOffered(product, claims.ks[index]))
  const planned = planProducts(products)
  const existing = await findExisting(deps.reader, planned)
  const yaExistian = [...existing.values()]
  const toCreate = planned.filter((_, index) => !existing.has(index))
  if (toCreate.length === 0) return { creados: [], ya_existian: yaExistian, sin_clave_sat: 0 }

  const satIds = await resolveSatKeys(deps.reader, toCreate.map((p) => p.product.clave_sat), ALTA)
  const ids = await deps.writer.createProducts(
    proof,
    toCreate.map((p) => createVals(p, satIds)),
    dl,
  )
  return {
    creados: ids.map((id, index) => ({ id, nombre: toCreate[index].name })),
    ya_existian: yaExistian,
    sin_clave_sat: toCreate.filter((p) => !p.product.clave_sat).length,
  }
}

type Assignment = z.infer<typeof satAssignment>

/** many2one [id, name]: any id counts as a key, named or not (an "#id" would read like a SAT code). */
function currentKey(value: unknown): { readonly label: string | null } | null {
  if (!Array.isArray(value) || !isId(value[0])) return null
  return { label: many2oneName(value) }
}

/** Existing products the preview flagged (claims.a), each with an offered or typed key; one write per key. */
async function assignSatKeys(
  deps: OdooQuotationDeps,
  proof: AdminProof,
  claims: ProductsKeyClaims,
  entries: readonly Assignment[],
  dl: Deadline,
): Promise<SatAssignResult> {
  const offered = new Map(claims.a)
  const seen = new Set<number>()
  for (const entry of entries) {
    if (seen.has(entry.producto_id)) throw new ToolError(`El producto #${entry.producto_id} viene dos veces. ${ASSIGN.nothing}`)
    seen.add(entry.producto_id)
    if (!offered.has(entry.producto_id)) throw new ToolError(PRODUCTS_CHANGED_MESSAGE)
    assertOffered(entry, offered.get(entry.producto_id))
  }

  const ids = [...seen].sort((a, b) => a - b)
  const current = new Map<number, { name: string; key: { readonly label: string | null } | null }>()
  for (const row of rowsOf(
    await deps.reader('product.product', 'search_read', {
      domain: [['id', 'in', ids]],
      fields: ['name', 'unspsc_code_id'],
      limit: ids.length,
      context: { active_test: false },
    }),
  )) {
    if (!isId(row.id) || typeof row.name !== 'string') {
      throw new OdooError(`Odoo devolvió un producto que no pude leer: ${lowerFirst(ASSIGN.nothing)}`)
    }
    current.set(row.id, { name: row.name, key: currentKey(row.unspsc_code_id) })
  }
  const gone = ids.find((id) => !current.has(id))
  if (gone !== undefined) throw new ToolError(`El producto #${gone} ya no está en Odoo: vuelve a pedir la vista previa. ${ASSIGN.nothing}`)

  const yaTenian: AlreadyKeyedProduct[] = []
  const pending: KeyedProduct[] = []
  for (const entry of entries) {
    const product = current.get(entry.producto_id)
    if (!product) continue
    // Captured in Odoo since the preview: whoever did it wins (#154).
    if (product.key) yaTenian.push({ id: entry.producto_id, nombre: product.name, clave_sat: product.key.label })
    else pending.push({ id: entry.producto_id, nombre: product.name, clave_sat: entry.clave_sat })
  }
  if (pending.length === 0) return { asignados: [], ya_tenian: yaTenian }

  const satIds = await resolveSatKeys(deps.reader, pending.map((p) => p.clave_sat), ASSIGN)
  const byKey = new Map<number, number[]>()
  for (const p of pending) {
    const satId = satIds.get(p.clave_sat)
    if (satId === undefined) throw new OdooError(`No pude resolver la clave SAT: ${lowerFirst(ASSIGN.nothing)}`)
    byKey.set(satId, [...(byKey.get(satId) ?? []), p.id])
  }
  // One write per key; a retry after a partial failure finds the done ones in ya_tenian.
  for (const [satId, productIds] of byKey) await deps.writer.assignSatKey(proof, productIds, satId, dl)
  return { asignados: pending, ya_tenian: yaTenian }
}

/**
 * Only the view's button calls this: without the preview's authorization nothing is written.
 * Products already in Odoo (a repeated click) are reported, never duplicated; a key already there is never replaced.
 */
export async function odooSaveProduct(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: SaveProductInput,
): Promise<ProductsSaveResult | SatAssignResult> {
  // First: the live-admin read counts against the request's budget (#144).
  const dl = startDeadline()
  const proof = await requireLiveAdmin(ctx)
  if (typeof raw?.autorizacion !== 'string' || !raw.autorizacion.trim()) throw new ToolError(PRODUCTS_UNAUTHORIZED_MESSAGE)
  const input = parseInput('odoo_save_product', saveProductShape, raw)
  if ((input.productos === undefined) === (input.asignar === undefined)) throw new ToolError(ONE_MODE)
  // Throws the precise reason (no key, bad URL) before anything is read.
  odooWriteEnv()
  const claims = verifyProductsAuthorization(proof, input.autorizacion, input.productos ?? null)
  if (input.asignar) return assignSatKeys(deps, proof, claims, input.asignar, dl)
  return createProducts(deps, proof, claims, input.productos ?? [], dl)
}
