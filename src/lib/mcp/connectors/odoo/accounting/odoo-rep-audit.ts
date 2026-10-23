import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooRepAudit } from '@/lib/mcp/tools/odoo/payments'

export const odooRepAuditTool = defineTool({
  connector: 'odoo',
  name: 'odoo_rep_audit',
  kind: 'read',
  title: 'Auditoría de complementos de pago (Odoo)',
  description:
    'Barrido de pagos de cliente de Odoo (externo) en un rango de fechas, clasificados por su complemento de pago (REP): en regla, SIN REP, o con REP fallido/no válido ante el SAT. El cruce pago→REP es por las facturas conciliadas. Default: últimos 30 días. Úsala para el barrido mensual de "¿qué pagos se quedaron sin timbrar?".',
  input: {
    date_from: z.string().optional().describe('Desde (YYYY-MM-DD); default hace 30 días'),
    date_to: z.string().optional().describe('Hasta (YYYY-MM-DD); default hoy'),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Auditoria de complementos de pago',
    example: '¿Que pagos del mes se quedaron sin REP?',
  },
  handler: (input) => odooRepAudit(callOdoo, input),
})
