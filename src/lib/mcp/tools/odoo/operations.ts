/** Odoo phase 3 (ADR-025), read-only. Stock truth is stock.quant — qty_available is computed, not stored. */

import type { OdooCaller } from '@/lib/odoo/client'
import { normalizeGroups } from '@/lib/odoo/normalize'
import { ToolError } from '@/lib/mcp/core/errors'

const STOCK_LIST_LIMIT = 20

export async function odooSearchStock(odoo: OdooCaller, input: { producto: string }) {
  const query = input.producto?.trim()
  if (!query) throw new ToolError('Indica el nombre o código del producto a buscar')

  // 1 call: grouping quants by product sums every location, and ilike on the many2one
  // searches the display name (code + name) at once.
  const groups = normalizeGroups(
    await odoo('stock.quant', 'read_group', {
      domain: [['product_id', 'ilike', query]],
      fields: ['quantity:sum', 'available_quantity:sum'],
      groupby: ['product_id'],
    }),
  )

  const todas = groups
    .map((g) => ({
      producto: (g.product_id as string | null) ?? '—',
      en_mano: (g.quantity as number) ?? 0,
      disponible: (g.available_quantity as number) ?? 0,
    }))
    .sort((a, b) => b.en_mano - a.en_mano)
  // Only rows with stock; zeros go as a count — 50 zero rows are noise, not information.
  const conExistencia = todas.filter((e) => e.en_mano > 0)

  return {
    busqueda: query,
    coincidencias: todas.length,
    en_cero: todas.length - conExistencia.length,
    // undefined disappears on serialize.
    mensaje: todas.length === 0
      ? `Ningún producto con existencias registradas en Odoo coincide con "${query}"`
      : undefined,
    nota: conExistencia.length > STOCK_LIST_LIMIT
      ? `Se listan las ${STOCK_LIST_LIMIT} con más existencia de ${conExistencia.length} con stock — afina la búsqueda para ver el resto.`
      : undefined,
    existencias: conExistencia.slice(0, STOCK_LIST_LIMIT),
  }
}
