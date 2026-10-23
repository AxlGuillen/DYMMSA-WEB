import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooReceivablesRanking } from '@/lib/mcp/tools/odoo/receivables'

export const odooReceivablesRankingTool = defineTool({
  connector: 'odoo',
  name: 'odoo_receivables_ranking',
  kind: 'read',
  title: 'Ranking de cobranza (Odoo)',
  description:
    'Responde "¿a quién le cobro primero?" y "¿quién paga más lento?" desde la facturación oficial (Odoo): los clientes (customer_rank > 0) con saldo, con la deuda total, el vencido y los días promedio de pago (DSO) que Odoo calcula por cliente — saldos contables netos de notas de crédito. Devuelve el top por vencido (luego por deuda), el top de los más lentos ENTRE los que hoy tienen saldo (quien paga lento pero está al corriente no aparece) y los totales de esa cartera. Úsala para la revisión semanal de cobranza; para el detalle de uno, odoo_customer_profile.',
  input: {
    limit: z.number().int().min(1).max(50).optional().describe('Cuántos clientes por lista (default 10)'),
  },
  annotations: readOnly,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Ranking de cobranza',
    example: '¿A quien le cobro primero? ¿Quien paga mas lento?',
  },
  handler: (input) => odooReceivablesRanking(callOdoo, input),
})
