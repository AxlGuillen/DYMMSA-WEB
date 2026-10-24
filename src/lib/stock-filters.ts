/** Store stock filters (#155 C1): one list for /api/inventory, its hook and the MCP enum; client-safe. */
export const STOCK_FILTERS = ['all', 'with_stock', 'in_stock', 'low_stock', 'sin_stock'] as const

export type StockFilter = (typeof STOCK_FILTERS)[number]
