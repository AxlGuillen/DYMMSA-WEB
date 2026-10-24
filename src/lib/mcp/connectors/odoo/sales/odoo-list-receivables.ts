import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { odooListReceivables, RECEIVABLES_ORDER } from '@/lib/mcp/tools/odoo/receivables'
import { odooRead } from '../shared'

export const odooListReceivablesTool = defineTool({
  connector: 'odoo',
  name: 'odoo_list_receivables',
  kind: 'read',
  title: 'Cartera por cobrar (Odoo)',
  description:
    'Toda la cartera de Odoo: "¿quién nos debe y desde cuándo?", "¿a quién le cobro primero?", "¿quién paga más lento?". Cifra bruta por factura abierta, como la pantalla Clientes: totales, `por_cliente` (vencido, por vencer, total y días promedio de pago), las facturas más antiguas y las notas de crédito aparte, sin restar. `ordenar`: vencido (default), total o dias_pago. Para el estado de cuenta de uno, odoo_get_customer.',
  input: {
    ordenar: z.enum(RECEIVABLES_ORDER).optional().describe('Default vencido'),
    limite: z.number().int().min(1).max(50).optional().describe('Clientes y facturas por lista (default 10)'),
  },
  annotations: odooRead,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Cartera por cobrar',
    example: '¿A quien le cobro primero? ¿Quien paga mas lento?',
  },
  handler: (input) => odooListReceivables(callOdoo, input),
})
