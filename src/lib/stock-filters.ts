import { tokenMap } from '@/lib/tokens'

/** Store stock filters (#155 C1): one list for /api/inventory, its hook and the MCP enum; client-safe. */
export const STOCK_FILTERS = ['all', 'with_stock', 'in_stock', 'low_stock', 'sin_stock'] as const

export type StockFilter = (typeof STOCK_FILTERS)[number]

/** The assistant's tokens (#155 C6); `poca` is 1-5 pieces and `suficiente` more than 5. */
export const STOCK_FILTER_TOKENS = tokenMap({
  all: 'todas',
  with_stock: 'con_existencia',
  in_stock: 'suficiente',
  low_stock: 'poca',
  sin_stock: 'sin_existencia',
} as const satisfies Record<StockFilter, string>)
