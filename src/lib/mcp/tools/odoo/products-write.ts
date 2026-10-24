/**
 * odoo_save_product (#144, ADR-040): creates the preview's new goods, only from the view's button —
 * its authorization rides in _meta, never in the text the model reads. All or nothing, never twice.
 */

import { z } from 'zod'
import type { DomainTriple } from '@/lib/odoo/catalog'
import { OdooError } from '@/lib/odoo/client'
import { startDeadline } from '@/lib/odoo/deadline'
import { escapeLike, orDomain } from '@/lib/odoo/domains'
import { odooWriteEnv } from '@/lib/odoo/env'
import { PRODUCTS_UNAUTHORIZED_MESSAGE, verifyProductsAuthorization } from '@/lib/odoo/preview-token'
import { LINE_PRICE_MAX, MAX_NEW_PRODUCTS, productName, splitEtm, type ProductForCreation } from '@/lib/odoo/quotation-plan'
import { ETM_CODE_LIST, type ProductCreateVals } from '@/lib/odoo/write-catalog'
import type { McpContext } from '../../core/context'
import { fold } from '@/lib/text'
import { requireLiveAdmin } from '@/lib/mcp/core/auth/live-admin'
import { ToolError } from '@/lib/mcp/core/errors'
import { parseInput, type OdooQuotationDeps } from './quotations'
import { isId, rowsOf } from './resolve'

type ToolContext = Pick<McpContext, 'db' | 'userId' | 'role'>

/** The SAT's "no existe en el catálogo": stamping needs the real key, so it is never written. */
export const SAT_PLACEHOLDER = '01010101'

// Mirrors ProductForCreation (quotation-plan.ts): the view sends productos_para_alta as it came.
const productForCreation = z.strictObject({
  codigo: z.string().min(1).max(40),
  descripcion: z.string().min(1).max(200),
  marca: z.string().min(1).max(40).optional(),
  etm: z.string().regex(ETM_CODE_LIST, 'ETM de 9 dígitos (o varios separados por comas)').optional(),
  precio: z.number().min(0).max(LINE_PRICE_MAX),
  clave_sat: z.string().regex(/^\d{8}$/, 'clave SAT de 8 dígitos').optional(),
})

export const saveProductShape = {
  productos: z.array(productForCreation).min(1).max(MAX_NEW_PRODUCTS).describe('productos_para_alta, tal cual'),
  autorizacion: z.string().min(1).max(4000).describe('La de la vista previa'),
}

const saveProductSchema = z.strictObject(saveProductShape)

export type SaveProductInput = z.infer<typeof saveProductSchema>

export interface SavedProduct {
  readonly id: number
  readonly nombre: string
}

/** odoo_save_product's result; the view reports it in its one updateModelContext. */
export interface ProductsSaveResult {
  readonly creados: readonly SavedProduct[]
  readonly ya_existian: readonly SavedProduct[]
  /** Created without a SAT key: they can't be stamped until it is captured in Odoo. */
  readonly sin_clave_sat: number
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

/** Every SAT key to write, in ONE search by code; a missing or placeholder key stops before creating. */
async function resolveSatKeys(
  reader: OdooQuotationDeps['reader'],
  planned: readonly PlannedProduct[],
): Promise<Map<string, number>> {
  const codes = [...new Set(planned.flatMap((p) => (p.product.clave_sat ? [p.product.clave_sat] : [])))]
  if (codes.includes(SAT_PLACEHOLDER)) {
    throw new ToolError(
      `La clave SAT ${SAT_PLACEHOLDER} significa «no existe en el catálogo»: usa la clave real o quítala (se captura después en Odoo). No se creó nada.`,
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
    if (!isId(row.id) || typeof row.code !== 'string') throw new OdooError('Odoo devolvió una clave SAT que no pude leer: no se creó nada.')
    found.set(row.code, [...(found.get(row.code) ?? []), row.id])
  }
  const missing = codes.filter((code) => !found.has(code))
  if (missing.length > 0) {
    const one = missing.length === 1
    throw new ToolError(
      `${one ? 'La clave SAT' : 'Las claves SAT'} ${missing.join(', ')} no ${one ? 'existe' : 'existen'} en el catálogo del SAT de Odoo: corrígela${one ? '' : 's'} o quítala${one ? '' : 's'} y vuelve a pedir la vista previa. No se creó nada.`,
    )
  }
  const repeated = codes.find((code) => (found.get(code) ?? []).length > 1)
  if (repeated) throw new ToolError(`La clave SAT ${repeated} aparece más de una vez en Odoo: da de alta el producto ahí. No se creó nada.`)
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

/**
 * Only the view's button calls this: without the preview's authorization nothing is created.
 * Products already in Odoo (a repeated click) are reported, never duplicated.
 */
export async function odooSaveProduct(
  deps: OdooQuotationDeps,
  ctx: ToolContext,
  raw: SaveProductInput,
): Promise<ProductsSaveResult> {
  // First: the live-admin read counts against the request's budget (#144).
  const dl = startDeadline()
  const proof = await requireLiveAdmin(ctx)
  if (typeof raw?.autorizacion !== 'string' || !raw.autorizacion.trim()) throw new ToolError(PRODUCTS_UNAUTHORIZED_MESSAGE)
  const input = parseInput(saveProductSchema, raw)
  // Throws the precise reason (no key, bad URL) before anything is read.
  odooWriteEnv()
  verifyProductsAuthorization(proof, input.autorizacion, input.productos)

  const planned = planProducts(input.productos)
  const existing = await findExisting(deps.reader, planned)
  const yaExistian = [...existing.values()]
  const toCreate = planned.filter((_, index) => !existing.has(index))
  if (toCreate.length === 0) return { creados: [], ya_existian: yaExistian, sin_clave_sat: 0 }

  const satIds = await resolveSatKeys(deps.reader, toCreate)
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
