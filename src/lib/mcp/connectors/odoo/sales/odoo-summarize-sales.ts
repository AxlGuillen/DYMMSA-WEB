import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { odooSummarizeSales } from '@/lib/mcp/tools/odoo/sales'
import { odooRead } from '../shared'

export const odooSummarizeSalesTool = defineTool({
  connector: 'odoo',
  name: 'odoo_summarize_sales',
  kind: 'read',
  title: 'Resumen de ventas (Odoo)',
  description:
    'Ventas registradas en Odoo por periodo: total y órdenes, agrupado por estado (default), cliente, vendedor o mes. Por default solo ventas CONFIRMADAS (sale/done); incluir="todas" suma las cotizaciones draft/sent de Odoo. No confundir con las cotizaciones de DYMMSA-WEB.',
  input: {
    date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre date_order)'),
    date_to: z.string().optional().describe('Hasta (YYYY-MM-DD)'),
    group_by: z.enum(['estado', 'cliente', 'vendedor', 'mes']).optional(),
    incluir: z.enum(['confirmadas', 'todas']).optional(),
  },
  annotations: odooRead,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Resumen de ventas',
    example: 'Ventas confirmadas por vendedor este mes.',
  },
  handler: (input) => odooSummarizeSales(callOdoo, input),
})
