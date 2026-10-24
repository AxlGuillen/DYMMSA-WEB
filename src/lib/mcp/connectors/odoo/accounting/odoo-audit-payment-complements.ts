import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { odooAuditPaymentComplements } from '@/lib/mcp/tools/odoo/payments'
import { odooRead } from '../shared'

export const odooAuditPaymentComplementsTool = defineTool({
  connector: 'odoo',
  name: 'odoo_audit_payment_complements',
  kind: 'read',
  title: 'Auditoría de complementos de pago (Odoo)',
  description:
    'Barrido de pagos de cliente de Odoo en un rango de fechas, clasificados por su complemento de pago (REP): en regla, SIN REP, o con REP fallido/no válido ante el SAT. El cruce pago→REP es por las facturas conciliadas. Default: últimos 30 días. Úsala para el barrido mensual de "¿qué pagos se quedaron sin timbrar?"; el detalle de uno, con odoo_get_document.',
  input: {
    desde: isoDate.optional().describe('Default hace 30 días'),
    hasta: isoDate.optional().describe('Default hoy'),
  },
  annotations: odooRead,
  docs: {
    module: 'Contabilidad',
    title: 'Auditoria de complementos de pago',
    example: '¿Que pagos del mes se quedaron sin REP?',
  },
  handler: (input) => odooAuditPaymentComplements(callOdoo, input),
})
