import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooSalesSummary } from '@/lib/mcp/tools/odoo/sales'

export const odooSalesSummaryTool = defineTool({
  connector: 'odoo',
  name: 'odoo_sales_summary',
  kind: 'read',
  title: 'Resumen de ventas (Odoo)',
  description:
    'Ventas registradas en Odoo (externo) por periodo: total y órdenes, agrupado por estado (default), cliente, vendedor o mes. Por default solo ventas CONFIRMADAS (sale/done); incluir="todas" suma las cotizaciones draft/sent de Odoo. No confundir con las cotizaciones de DYMMSA-WEB.',
  input: {
    date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre date_order)'),
    date_to: z.string().optional().describe('Hasta (YYYY-MM-DD)'),
    group_by: z.enum(['estado', 'cliente', 'vendedor', 'mes']).optional(),
    incluir: z.enum(['confirmadas', 'todas']).optional(),
  },
  annotations: readOnly,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Resumen de ventas',
    example: 'Ventas confirmadas por vendedor este mes.',
  },
  handler: (input) => odooSalesSummary(callOdoo, input),
})
