import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { odooAggregateRecords } from '@/lib/mcp/tools/odoo/accounting'
import { domainSchema, odooRead } from '../shared'

export const odooAggregateRecordsTool = defineTool({
  connector: 'odoo',
  name: 'odoo_aggregate_records',
  kind: 'read',
  title: 'Totales agrupados (Odoo)',
  description:
    'Primitiva: totales y conteos agrupados calculados POR Odoo sobre un modelo del catálogo permitido, sin traer registros: agrupa por un campo y suma/promedia métricas. Ej.: facturas por payment_state con amount_total:sum. No separa notas de crédito ni filtra por estado: la facturación o las ventas de un periodo salen de odoo_summarize_invoices / odoo_summarize_sales.',
  input: {
    modelo: z.string().describe('Modelo Odoo del catálogo'),
    filtros: domainSchema,
    agrupar_por: z.string().describe('Campo de agrupación, p. ej. "payment_state", "partner_id" o "invoice_date:month"'),
    metricas: z.array(z.string()).optional().describe('"campo:agregador" (sum|avg|min|max|count), p. ej. ["amount_total:sum"]'),
  },
  annotations: odooRead,
  docs: {
    module: 'Consultas libres',
    title: 'Totales agrupados en Odoo',
    example: '¿Cuantas facturas hay por estado de pago y cuanto suman?',
  },
  handler: (input) => odooAggregateRecords(callOdoo, input),
})
