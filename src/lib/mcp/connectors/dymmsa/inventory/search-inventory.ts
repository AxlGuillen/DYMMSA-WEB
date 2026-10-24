import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination, readOnly } from '@/lib/mcp/core/schema'
import { searchInventory } from '@/lib/mcp/tools/inventory'
import { STOCK_FILTERS } from '@/lib/stock-filters'

export const searchInventoryTool = defineTool({
  connector: 'dymmsa',
  name: 'search_inventory',
  kind: 'read',
  title: 'Buscar en inventario',
  description:
    'Stock de tienda por model_code, con ubicación física (gaveta) cuando hay existencias. stockFilter: with_stock (>0), in_stock (>5), low_stock (1-5), sin_stock (0). Úsala para "¿tenemos el 6954? ¿dónde está?".',
  input: {
    search: z.string().optional().describe('Busca por model_code (parcial)'),
    stockFilter: z.enum(STOCK_FILTERS).optional().describe('Default all'),
    ...pagination,
  },
  annotations: readOnly,
  docs: {
    module: 'Inventario',
    title: 'Buscar en inventario',
    example: '¿Tenemos el 6954 y en que gaveta esta?',
  },
  handler: (input, { db }) => searchInventory(db, input),
})
