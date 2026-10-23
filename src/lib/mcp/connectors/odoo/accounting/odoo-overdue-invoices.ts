import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooOverdueInvoices } from '@/lib/mcp/tools/odoo/accounting'

export const odooOverdueInvoicesTool = defineTool({
  connector: 'odoo',
  name: 'odoo_overdue_invoices',
  kind: 'read',
  title: 'Cartera y estado de cuenta (Odoo)',
  description:
    'Sin parámetros: "¿quién nos debe y desde cuándo?" — por cliente y las más vencidas. Con `cliente`, `vence_desde`/`vence_hasta` (YYYY-MM-DD, por VENCIMIENTO; solo `cliente` = vencido + este mes) o `incluir`: el ESTADO DE CUENTA, por cliente o el de uno con todas sus facturas. `notas_credito_sin_aplicar` va aparte, sin restar.',
  input: {
    limit: z.number().int().min(1).max(50).optional().describe('Sin cliente: cuántas listar (default 10)'),
    cliente: z.string().min(1).optional().describe('Nombre (o parte)'),
    vence_desde: z.string().optional(),
    vence_hasta: z.string().optional(),
    incluir: z.enum(['vencidas', 'por_vencer', 'ambas']).optional().describe('Default ambas'),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Cartera y estado de cuenta',
    example: 'Estado de cuenta de Andritz: lo vencido y lo que vence este mes.',
  },
  handler: (input) => odooOverdueInvoices(callOdoo, input),
})
