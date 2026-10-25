/** Inventory tools (read-only): same query and stock filters as GET /api/inventory. */

import type { WritePlan } from '@/lib/mcp/core/define'
import { diff, listResult, writeResult, type Changes } from '@/lib/mcp/core/envelope'
import { changeStock, createInventoryItem, findInventoryRows, heldByOpenOrders, setInventoryLocation, type InventoryRow, type StockChange } from '@/lib/inventory-store'
import { normalizeCatalogCode } from '@/lib/business-rules'
import { normalizePagination } from '@/lib/mcp/core/schema'
import { sanitizeSearch } from '@/lib/text'
import { ToolError } from '@/lib/mcp/core/errors'
import type { Db } from '@/lib/mcp/core/db'
import { STOCK_FILTER_TOKENS } from '@/lib/stock-filters'
import type { StoreInventory } from '@/types/database'

export interface SearchInventoryInput {
  buscar?: string
  existencias?: string
  pagina?: number
  por_pagina?: number
}

export async function searchInventory(db: Db, input: SearchInventoryInput) {
  const stockFilter = STOCK_FILTER_TOKENS.toDb(input.existencias ?? 'todas')
  // An unknown filter is an error, never "all" in silence (#155 C1).
  if (!stockFilter) throw new ToolError(`Filtro inválido "${input.existencias}": usa ${STOCK_FILTER_TOKENS.tokens.join(' | ')}`)
  const { pagina, por_pagina, from, to } = normalizePagination(input)

  let query = db.from('store_inventory').select('*', { count: 'exact' })

  // Sanitized even though this is a plain .ilike() today, in case the query grows an .or().
  const search = sanitizeSearch(input.buscar ?? '')
  if (search) query = query.ilike('model_code', `%${search}%`)

  if (stockFilter === 'sin_stock') query = query.eq('quantity', 0)
  else if (stockFilter === 'with_stock') query = query.gt('quantity', 0)
  else if (stockFilter === 'low_stock') query = query.gt('quantity', 0).lte('quantity', 5)
  else if (stockFilter === 'in_stock') query = query.gt('quantity', 5)

  const { data, error, count } = await query
    .order('model_code', { ascending: true })
    .range(from, to)

  if (error) throw new ToolError(`Error al obtener el inventario: ${error.message}`)

  const items = ((data ?? []) as StoreInventory[]).map((i) => ({
    codigo: i.model_code,
    cantidad: i.quantity,
    // Location is kept at quantity=0 but only shown with stock (same rule as the frontend):
    // never send anyone to an empty drawer.
    ubicacion: i.quantity > 0 ? i.location : null,
    actualizado_el: i.updated_at,
  }))

  // An exact code is the context of any adjustment: what open orders still hold of it (decision 6 of #155 D).
  const exact = items.length === 1 && search.toLowerCase() === items[0].codigo.toLowerCase() ? items[0] : null
  if (exact) {
    const held = (await heldByOpenOrders(db, [exact.codigo])).get(exact.codigo) ?? 0
    if (held > 0) Object.assign(exact, { apartado_en_ordenes: held })
  }

  return listResult('articulos', items, { total: count ?? 0, pagina, por_pagina })
}

export async function getInventoryStats(db: Db) {
  const { data, error } = await db.from('store_inventory').select('quantity')
  if (error) throw new ToolError(`Error al obtener las métricas: ${error.message}`)

  const items = (data ?? []) as { quantity: number }[]
  return {
    total: items.length,
    [STOCK_FILTER_TOKENS.toToken('sin_stock')]: items.filter((i) => i.quantity === 0).length,
    [STOCK_FILTER_TOKENS.toToken('low_stock')]: items.filter((i) => i.quantity > 0 && i.quantity <= 5).length,
    [STOCK_FILTER_TOKENS.toToken('in_stock')]: items.filter((i) => i.quantity > 5).length,
  }
}

// ── save_inventory_item (#155 D) ─────────────────────────────────────────────

export interface InventoryLineInput {
  codigo: string
  /** '' clears the drawer. */
  ubicacion?: string
  /** The physical count: the available stock stored is this minus what open orders hold (decision 6). */
  cantidad_contada?: number
  /** A delta, never 0. */
  ajuste?: number
}

export interface SaveInventoryItemInput {
  productos: InventoryLineInput[]
  /** Allows codes that are not in inventory yet (a typo would otherwise create a ghost row). */
  crear?: true
  /** Why the quantity changes; goes to the audit trail. Required with any quantity. */
  motivo?: string
}

interface PlannedLine {
  codigo: string
  existing: InventoryRow | null
  held: number
  /** What to do to the quantity, if anything. */
  stock: StockChange | null
  /** Available stock after the line; the summary and the answer show it. */
  after: number | null
  /** The drawer to write, if any ('' = clear). */
  ubicacion: string | undefined
  /** A new code with no quantity (a drawer only) is inserted by hand. */
  createEmpty: boolean
}

type InventoryCarry = { lines: PlannedLine[]; motivo: string }

const qtyOf = (line: InventoryLineInput) => line.cantidad_contada !== undefined || line.ajuste !== undefined

/** Reads every code and what orders hold, validates all the lines, and writes nothing. */
export async function planSaveInventoryItem(db: Db, input: SaveInventoryItemInput): Promise<WritePlan<InventoryCarry>> {
  const typed = input.productos.map((p) => p.codigo.trim())
  if (typed.some((code) => !code)) throw new ToolError('Cada producto lleva su `codigo`.')
  if (new Set(typed.map((code) => code.toLowerCase())).size !== typed.length) throw new ToolError('Un código aparece dos veces en la misma llamada.')
  const motivo = input.motivo?.trim() ?? ''
  if (input.productos.some(qtyOf) && !motivo) throw new ToolError('Un cambio de cantidad lleva su `motivo` ("conteo del 24 de octubre", "se rompió uno").')

  const found = await Promise.all(typed.map((code) => findInventoryRows(db, code)))
  const clashes = typed.filter((_, i) => found[i].length > 1)
  if (clashes.length > 0) throw new ToolError(`${clashes.map((c) => `"${c}"`).join(', ')} coincide con varios códigos por mayúsculas/minúsculas — repórtalo, no debería pasar.`)
  const missing = typed.filter((_, i) => found[i].length === 0)
  if (missing.length > 0 && !input.crear) {
    throw new ToolError(
      `${missing.map((c) => `"${c}"`).join(', ')} no ${missing.length > 1 ? 'están' : 'está'} en el inventario (search_inventory verifica el código). Para darlo de alta repite con \`crear: true\`.`,
    )
  }

  const codes = typed.map((code, i) => found[i][0]?.model_code ?? normalizeCatalogCode(code))
  const heldBy = await heldByOpenOrders(db, codes)
  const avisos: string[] = []
  const bloqueos: string[] = []

  const lines: PlannedLine[] = input.productos.map((p, i) => {
    const existing = found[i][0] ?? null
    const codigo = codes[i]
    const held = heldBy.get(codigo) ?? 0
    const tag = `«${codigo}»`
    if (p.cantidad_contada !== undefined && p.ajuste !== undefined) throw new ToolError(`${tag}: \`cantidad_contada\` y \`ajuste\` no van juntos.`)
    if (p.ajuste === 0) throw new ToolError(`${tag}: un ajuste de 0 no cambia nada.`)
    if (p.ubicacion === undefined && !qtyOf(p)) throw new ToolError(`${tag}: indica \`ubicacion\`, \`cantidad_contada\` o \`ajuste\`.`)
    const before = existing?.quantity ?? 0
    let stock: StockChange | null = null
    let after: number | null = before

    if (p.cantidad_contada !== undefined) {
      const target = p.cantidad_contada - held
      if (held > 0) avisos.push(`${tag}: contaste ${p.cantidad_contada} y las órdenes abiertas tienen apartadas ${held}, así que quedan ${Math.max(target, 0)} disponibles.`)
      if (target < 0) {
        bloqueos.push(`${tag}: contaste ${p.cantidad_contada} pero las órdenes abiertas ya tienen apartadas ${held}. Revisa el conteo o esas órdenes.`)
      } else if (target !== before) {
        stock = existing ? { mode: 'count', value: target, expected: before } : { mode: 'delta', value: target }
      }
      after = Math.max(target, 0)
    } else if (p.ajuste !== undefined) {
      if (!existing && p.ajuste < 0) throw new ToolError(`${tag} no está en el inventario: no se le puede restar.`)
      stock = { mode: 'delta', value: p.ajuste }
      after = Math.max(0, before + p.ajuste)
      if (before + p.ajuste < 0) avisos.push(`${tag}: hay ${before} y se restan ${-p.ajuste}; queda en 0 (la cantidad nunca es negativa).`)
    }
    if (!existing && (stock || p.ubicacion !== undefined)) avisos.push(`${tag} entra al inventario${after ? ` con ${after} disponibles: la siguiente orden los toma` : ''}.`)
    return { codigo, existing, held, stock, after, ubicacion: p.ubicacion?.trim(), createEmpty: !existing && !stock }
  })

  const cambios: Record<string, { antes: unknown; ahora: unknown }> = {}
  for (const l of lines) {
    if (l.stock || (!l.existing && l.after !== null)) cambios[`cantidad ${l.codigo}`] = { antes: l.existing?.quantity ?? null, ahora: l.after }
    if (l.ubicacion !== undefined) Object.assign(cambios, diff({ [`ubicacion ${l.codigo}`]: l.existing?.location ?? null }, { [`ubicacion ${l.codigo}`]: l.ubicacion || null }))
  }
  const touchesQuantity = lines.some((l) => l.stock || !l.existing)
  return {
    entity: {
      key: 'productos',
      value: lines.map((l) => ({
        codigo: l.codigo,
        cantidad: l.after,
        ...(l.held > 0 ? { apartado_en_ordenes: l.held } : {}),
        ubicacion: l.ubicacion === undefined ? (l.existing?.location ?? null) : l.ubicacion || null,
      })),
    },
    cambios: cambios as Changes,
    avisos,
    bloqueos: bloqueos.length > 0 ? bloqueos : undefined,
    sinCambios: Object.keys(cambios).length === 0 && bloqueos.length === 0,
    // A drawer is metadata, not stock: only that writes at once. Any quantity asks for the yes.
    directo: !touchesQuantity,
    // The stock read and what orders hold: a count or a new order in between voids the key (and a write moves them).
    fingerprint: lines.map((l) => [l.codigo, l.existing?.quantity ?? null, l.existing?.location ?? null, l.held]),
    subject: 'El inventario',
    carry: { lines, motivo },
  }
}

export async function commitSaveInventoryItem(db: Db, plan: WritePlan<InventoryCarry>) {
  const { lines, motivo } = plan.carry
  const done: string[] = []
  const stopped = (codigo: string, error: unknown) =>
    new ToolError(`${done.length ? `Ya quedó guardado: ${done.join(', ')}. ` : ''}Falló en ${codigo}: ${error instanceof Error ? error.message : 'error'}. Repite solo lo que falta.`)

  const saved: { codigo: string; cantidad: number | null; ubicacion: string | null }[] = []
  for (const line of lines) {
    try {
      let quantity = line.existing?.quantity ?? null
      if (line.createEmpty) {
        const created = await createInventoryItem(db, { model_code: line.codigo, quantity: 0, location: line.ubicacion || null })
        saved.push({ codigo: line.codigo, cantidad: created.quantity, ubicacion: created.location })
        done.push(`${line.codigo} (alta)`)
        continue
      }
      if (line.stock) {
        const result = await changeStock(db, line.codigo, line.stock, motivo)
        if (result.stale) throw new ToolError('su cantidad cambió desde el resumen (otra orden o conteo): vuelve a pedirlo')
        if (result.missing) throw new ToolError('ya no está en el inventario')
        quantity = result.quantity ?? line.after
      }
      let location = line.existing?.location ?? null
      if (line.ubicacion !== undefined) location = (await setInventoryLocation(db, line.codigo, line.ubicacion || null)).location
      saved.push({ codigo: line.codigo, cantidad: quantity, ubicacion: location })
      done.push(line.codigo)
    } catch (error) {
      throw done.length === 0 ? error : stopped(line.codigo, error)
    }
  }
  return writeResult('actualizado', 'productos', saved, {
    cambios: plan.cambios,
    avisos: plan.avisos,
    nota: saved.some((s) => s.ubicacion === null && lines.find((l) => l.codigo === s.codigo)?.ubicacion === '') ? 'Una ubicación vacía borra la gaveta.' : undefined,
  })
}

