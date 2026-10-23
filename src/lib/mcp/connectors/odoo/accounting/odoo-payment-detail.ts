import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooPaymentDetail } from '@/lib/mcp/tools/odoo/payments'

export const odooPaymentDetailTool = defineTool({
  connector: 'odoo',
  name: 'odoo_payment_detail',
  kind: 'read',
  title: 'Detalle de pago con su REP (Odoo)',
  description:
    'Un pago de cliente de Odoo (externo) completo por folio (p. ej. "PAY00068"): encabezado, estado del COMPLEMENTO DE PAGO (REP) — timbrado y estado ante el SAT — y el desglose de facturas que paga, cada una con su saldo y su propio CFDI. Acepta folio parcial; con varias coincidencias devuelve la lista.',
  input: {
    folio: z.string().min(1).describe('Folio del pago, p. ej. "PAY00068"'),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Detalle de pago con su REP',
    example: '¿El pago PAY00068 ya tiene su complemento?',
  },
  handler: (input) => odooPaymentDetail(callOdoo, input),
})
