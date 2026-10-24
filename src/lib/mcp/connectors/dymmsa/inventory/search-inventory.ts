import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { searchInventory } from '@/lib/mcp/tools/inventory'
import { STOCK_FILTER_TOKENS } from '@/lib/stock-filters'

export const searchInventoryTool = defineTool({
  connector: 'dymmsa',
  name: 'search_inventory',
  kind: 'read',
  title: 'Buscar en inventario',
  description:
    'Stock de tienda por código, con su ubicación física (gaveta) cuando hay existencias. `existencias`: con_existencia (>0), suficiente (>5), poca (1-5), sin_existencia (0). Úsala para "¿tenemos el 6954? ¿dónde está?".',
  input: {
    buscar: z.string().optional().describe('Código (parcial)'),
    existencias: z.enum(STOCK_FILTER_TOKENS.tokens).optional().describe('Default todas'),
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
