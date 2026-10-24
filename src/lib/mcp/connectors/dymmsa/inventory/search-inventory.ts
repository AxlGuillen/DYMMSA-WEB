import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { searchInventory, STOCK_FILTERS } from '@/lib/mcp/tools/inventory'

export const searchInventoryTool = defineTool({
  connector: 'dymmsa',
  name: 'search_inventory',
  kind: 'read',
  title: 'Buscar en inventario',
  description:
    'Stock de tienda por model_code, con ubicación física (gaveta) cuando hay existencias. stockFilter: in_stock (>5), low_stock (1-5), sin_stock (0). Úsala para "¿tenemos el 6954? ¿dónde está?".',
  input: {
    search: z.string().optional().describe('Busca por model_code (parcial)'),
    stockFilter: z.enum(STOCK_FILTERS).optional().describe('Default all'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Inventario',
    title: 'Buscar en inventario',
    example: '¿Tenemos el 6954 y en que gaveta esta?',
  },
  handler: (input, { db }) => searchInventory(db, input),
})
