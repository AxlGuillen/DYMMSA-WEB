import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooStockCheck } from '@/lib/mcp/tools/odoo/operations'

export const odooStockCheckTool = defineTool({
  connector: 'odoo',
  name: 'odoo_stock_check',
  kind: 'read',
  title: 'Existencias en Odoo',
  description:
    'Existencias en el ALMACÉN DE ODOO (externo), buscando por nombre o código de producto y sumando todas las ubicaciones. ⚠️ NO es el inventario de la tienda de DYMMSA-WEB — para ese usa search_inventory. Son dos inventarios distintos.',
  input: {
    producto: z.string().min(1).describe('Nombre o código del producto, p. ej. "punta de cobre" o "510023782"'),
  },
  annotations: readOnly,
  docs: {
    module: 'Operacion',
    title: 'Existencias en Odoo',
    example: '¿Cuantas puntas de cobre hay en el almacen de Odoo?',
  },
  handler: (input) => odooStockCheck(callOdoo, input),
})
