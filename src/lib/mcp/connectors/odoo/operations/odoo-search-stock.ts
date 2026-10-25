import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { odooSearchStock } from '@/lib/mcp/tools/odoo/operations'
import { odooRead } from '../shared'

export const odooSearchStockTool = defineTool({
  connector: 'odoo',
  name: 'odoo_search_stock',
  kind: 'read',
  title: 'Existencias del almacén (Odoo)',
  description:
    'Existencias en el ALMACÉN DE ODOO, buscando por nombre o código de producto y sumando todas las ubicaciones. ⚠️ NO es el inventario de la tienda: ese es search_inventory, del conector DYMMSA-WEB. Son dos inventarios distintos.',
  input: {
    producto: z.string().min(1).describe('Nombre o código del producto, p. ej. "punta de cobre" o "510023782"'),
  },
  hints: odooRead,
  docs: {
    module: 'Operacion',
    title: 'Existencias en Odoo',
    example: '¿Cuantas puntas de cobre hay en el almacen de Odoo?',
    evals: ['¿Cuántas puntas de cobre hay en el almacén de Odoo?', '¿Qué stock tiene Odoo del producto 5467?'],
  },
  handler: (input) => odooSearchStock(callOdoo, input),
})
