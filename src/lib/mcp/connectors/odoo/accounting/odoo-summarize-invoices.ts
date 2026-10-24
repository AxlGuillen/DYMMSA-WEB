import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { odooSummarizeInvoices } from '@/lib/mcp/tools/odoo/accounting'
import { odooRead } from '../shared'

export const odooSummarizeInvoicesTool = defineTool({
  connector: 'odoo',
  name: 'odoo_summarize_invoices',
  kind: 'read',
  title: 'Resumen de facturación (Odoo)',
  description:
    'Resumen de las facturas de cliente contabilizadas en Odoo por periodo: total facturado y pendiente, agrupado por estado_pago (default), cliente o mes. Úsala para "¿cómo cerró julio?" o "facturación por cliente del año". Las notas de crédito EMITIDAS EN EL PERIODO van aparte en `notas_credito` (total, sin_aplicar; no restan del facturado) — distinto de las abiertas a hoy que da odoo_list_receivables.',
  input: {
    desde: isoDate.optional().describe('Sobre invoice_date'),
    hasta: isoDate.optional(),
    agrupar_por: z.enum(['estado_pago', 'cliente', 'mes']).optional(),
  },
  annotations: odooRead,
  docs: {
    module: 'Contabilidad',
    title: 'Resumen de facturacion',
    example: '¿Como cerro julio en facturacion?',
  },
  handler: (input) => odooSummarizeInvoices(callOdoo, input),
})
