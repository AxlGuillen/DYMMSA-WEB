/**
 * save_urrea_catalog_item (#155 D, ADR-041): create or edit one row of the official URREA catalog. Rules in
 * urrea-catalog-store.ts (shared with /api/urrea-catalog). Only the description is low risk; a new row, a new STD
 * or a new identity moves the wholesale plan of every open order, so those say how many decisions go stale first.
 */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, refOf, writeResult } from '@/lib/mcp/core/envelope'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { DEFAULT_BRAND, normalizeCatalogBrand, normalizeCatalogCode } from '@/lib/business-rules'
import {
  catalogChangeImpact,
  countLinesToOrder,
  createCatalogItem,
  findCatalogRows,
  parseCatalogItemInput,
  updateCatalogItem,
  type NewCatalogItem,
} from '@/lib/urrea-catalog-store'
import type { UrreaCatalogItem, UrreaCatalogUpdate } from '@/types/database'

export interface SaveUrreaCatalogItemInput {
  codigo: string
  marca?: string
  crear?: true
  /** '' clears it. */
  descripcion?: string
  std?: number
  nuevo_codigo?: string
  nueva_marca?: string
}

type Carry = { kind: 'create'; item: NewCatalogItem } | { kind: 'update'; row: UrreaCatalogItem; updates: UrreaCatalogUpdate }

function present(row: Pick<UrreaCatalogItem, 'code' | 'brand' | 'description' | 'std'> & { id?: string }) {
  return { ...(row.id ? { ref: refOf(row.id) } : {}), codigo: row.code, marca: row.brand, descripcion: row.description, std: row.std }
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

const staleWarning = (impact: { staleDecisions: number; orders: number }, why: string) =>
  `${plural(impact.staleDecisions, 'decisión de compra guardada queda', 'decisiones de compra guardadas quedan')} desactualizada${impact.staleDecisions === 1 ? '' : 's'} (${plural(impact.orders, 'orden', 'órdenes')} en curso) ${why}: vuelve${impact.staleDecisions === 1 ? '' : 'n'} a pedir decisión.`

async function planCreate(db: Db, input: SaveUrreaCatalogItemInput, code: string, brandGiven: string | undefined): Promise<WritePlan<Carry>> {
  if (input.nuevo_codigo !== undefined || input.nueva_marca !== undefined) {
    throw new ToolError('`nuevo_codigo` y `nueva_marca` cambian una fila existente; al dar de alta, el código y la marca van en `codigo` y `marca`.')
  }
  const brand = brandGiven ?? DEFAULT_BRAND
  const rows = await findCatalogRows(db, code)
  if (rows.some((r) => r.brand === brand)) throw new ToolError(`Ya existe el ${code} de ${brand} en el catálogo: repite sin \`crear\` para editarlo.`)

  const item = parseCatalogItemInput({ code, brand, description: input.descripcion, std: input.std }, { create: true })
  const lines = await countLinesToOrder(db, { code, brand })
  const avisos = [`Desde ahora el ${code} de ${brand} va a URREA en el planificador de compra y su descripción oficial le gana a la curada.`]
  if (lines.lines > 0) avisos.push(`${plural(lines.lines, 'línea', 'líneas')} de ${plural(lines.orders, 'orden', 'órdenes')} en curso con algo por pedir pasan de compra local a URREA.`)
  if (rows.length > 0) avisos.push(`El código ya existe bajo otra marca (${rows.map((r) => r.brand).join(', ')}): son filas distintas.`)
  return {
    entity: { key: 'articulo', value: present(item) },
    avisos,
    fingerprint: { crear: `${brand}|${code}`, otras: rows.map((r) => r.brand), lineas: lines.lines },
    subject: `El ${code} de ${brand}`,
    carry: { kind: 'create', item },
  }
}

async function planUpdate(db: Db, input: SaveUrreaCatalogItemInput, code: string, brandGiven: string | undefined): Promise<WritePlan<Carry>> {
  const rows = await findCatalogRows(db, code)
  let row: UrreaCatalogItem | undefined
  if (brandGiven) row = rows.find((r) => r.brand === brandGiven)
  else if (rows.length === 1) row = rows[0]
  else if (rows.length > 1) throw new ToolError(`El código ${code} existe en ${rows.length} marcas (${rows.map((r) => r.brand).join(', ')}): indica \`marca\`.`)
  if (!row) {
    throw new ToolError(`No hay ${code}${brandGiven ? ` de ${brandGiven}` : ''} en el catálogo (search_urrea_catalog ayuda a buscarlo). Para darlo de alta repite con \`crear: true\`.`)
  }

  const wanted = Object.fromEntries(
    Object.entries({ description: input.descripcion, std: input.std, code: input.nuevo_codigo, brand: input.nueva_marca }).filter(([, v]) => v !== undefined),
  )
  if (Object.keys(wanted).length === 0) throw new ToolError('Indica qué cambiar: descripcion, std, nuevo_codigo o nueva_marca.')
  // The route's own parser: normalization of code and brand, whole STD > 0, blank description = null.
  const parsed = parseCatalogItemInput(wanted, { create: false })
  const updates = Object.fromEntries(
    Object.entries(parsed).filter(([key, value]) => (row as unknown as Record<string, unknown>)[key] !== value),
  ) as UrreaCatalogUpdate

  const identity = updates.code !== undefined || updates.brand !== undefined
  if (identity) {
    const target = { code: updates.code ?? row.code, brand: updates.brand ?? row.brand }
    if ((await findCatalogRows(db, target.code)).some((r) => r.brand === target.brand)) {
      throw new ToolError(`Ya existe el ${target.code} de ${target.brand} en el catálogo.`)
    }
  }

  const avisos: string[] = []
  let impact = { staleDecisions: 0, orders: 0 }
  if (identity) {
    // Moving the identity takes the old key out of the catalog: its saved decisions have no STD to match any more.
    impact = await catalogChangeImpact(db, row, null)
    avisos.push('Cambiar el código o la marca equivale a quitar la fila vieja y meter otra: pertenencia al catálogo, descripción oficial y decisiones de compra.')
    if (impact.staleDecisions > 0) avisos.push(staleWarning(impact, 'porque la clave vieja sale del catálogo'))
  } else if (updates.std !== undefined) {
    impact = await catalogChangeImpact(db, row, updates.std)
    avisos.push(
      impact.staleDecisions > 0
        ? staleWarning(impact, `por el cambio de std (${row.std} → ${updates.std})`)
        : `Ninguna decisión de compra guardada depende del std ${row.std}.`,
    )
  }
  if (updates.description !== undefined) avisos.push('La descripción oficial solo cambia las cotizaciones nuevas: las guardadas conservan la suya.')

  const after = { ...row, ...updates }
  return {
    entity: { key: 'articulo', value: present(after) },
    cambios: diff(present(row), present(after), ['ref']),
    avisos,
    sinCambios: Object.keys(updates).length === 0,
    // Only the description is low risk (Auditoría DYMMSA-WEB §3): the rest asks for the yes.
    directo: Object.keys(updates).every((key) => key === 'description'),
    // updated_at moves with the write (moddatetime), and the impact is part of what the yes was given for.
    fingerprint: { id: row.id, updated_at: row.updated_at, code: row.code, brand: row.brand, description: row.description, std: row.std, impact },
    subject: `El ${row.code} de ${row.brand}`,
    carry: { kind: 'update', row, updates },
  }
}

export async function planSaveUrreaCatalogItem(db: Db, input: SaveUrreaCatalogItemInput): Promise<WritePlan<Carry>> {
  const code = normalizeCatalogCode(input.codigo)
  if (!code) throw new ToolError('Indica el código (`codigo`).')
  const brand = input.marca === undefined ? undefined : normalizeCatalogBrand(input.marca)
  return input.crear ? planCreate(db, input, code, brand) : planUpdate(db, input, code, brand)
}

export async function commitSaveUrreaCatalogItem(db: Db, plan: WritePlan<Carry>) {
  const { carry } = plan
  if (carry.kind === 'create') {
    const created = await createCatalogItem(db, carry.item)
    return writeResult('creado', 'articulo', present(created), { avisos: plan.avisos })
  }
  const saved = await updateCatalogItem(db, carry.row.id, carry.updates)
  return writeResult('actualizado', 'articulo', present(saved), { cambios: plan.cambios, avisos: plan.avisos })
}
