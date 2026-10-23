import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooInvoicesSummary } from '@/lib/mcp/tools/odoo/accounting'

export const odooInvoicesSummaryTool = defineTool({
  connector: 'odoo',
  name: 'odoo_invoices_summary',
  kind: 'read',
  title: 'Resumen de facturación (Odoo)',
  description:
    'Resumen de las facturas de cliente contabilizadas en Odoo por periodo: total facturado y pendiente, agrupado por estado_pago (default), cliente o mes. Úsala para "¿cómo cerró julio?" o "facturación por cliente del año". Las notas de crédito EMITIDAS EN EL PERIODO van aparte en `notas_credito` (total, sin_aplicar; no restan del facturado) — distinto de las abiertas a hoy que da odoo_overdue_invoices.',
  input: {
    date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre invoice_date)'),
    date_to: z.string().optional().describe('Hasta (YYYY-MM-DD)'),
    group_by: z.enum(['estado_pago', 'cliente', 'mes']).optional(),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Resumen de facturacion',
    example: '¿Como cerro julio en facturacion?',
  },
  handler: (input) => odooInvoicesSummary(callOdoo, input),
})
