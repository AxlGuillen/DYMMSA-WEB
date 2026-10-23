import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooAggregate } from '@/lib/mcp/tools/odoo/accounting'
import { domainSchema } from '../shared'

export const odooAggregateTool = defineTool({
  connector: 'odoo',
  name: 'odoo_aggregate',
  kind: 'read',
  title: 'Agregados en Odoo',
  description:
    'Totales y conteos agrupados calculados POR Odoo (facturación de la empresa, externo) — la forma correcta de responder "¿cuánto…?" sin traer registros: agrupa por un campo y suma/promedia métricas. Ej.: facturas por payment_state con amount_total:sum.',
  input: {
    model: z.string().describe('Modelo Odoo del catálogo'),
    domain: domainSchema,
    group_by: z.string().describe('Campo de agrupación, p. ej. "payment_state", "partner_id" o "invoice_date:month"'),
    metrics: z.array(z.string()).optional().describe('Métricas "campo:agregador" (sum|avg|min|max|count), p. ej. ["amount_total:sum"]'),
  },
  annotations: readOnly,
  docs: {
    module: 'Consultas libres',
    title: 'Agregados en Odoo',
    example: 'Total facturado por cliente este año.',
  },
  handler: (input) => odooAggregate(callOdoo, input),
})
