import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooInvoiceDetail } from '@/lib/mcp/tools/odoo/documents'

export const odooInvoiceDetailTool = defineTool({
  connector: 'odoo',
  name: 'odoo_invoice_detail',
  kind: 'read',
  title: 'Detalle de factura (Odoo)',
  description:
    'Una factura de Odoo (externo) completa por folio (p. ej. "F00167"): encabezado con montos, saldo, término de pago real y notas al pie (p. ej. "PEDIDO: …"), el VÍNCULO con órdenes de venta (cuántas están ligadas de verdad + diagnóstico: ligada / vínculo roto / huérfana), TIMBRADO CFDI (folio fiscal/UUID, estado ante el SAT) y sus líneas con cantidad, unidad (piezas vs cajas) y si cada línea viene de una venta. Acepta folio parcial; con varias coincidencias devuelve la lista.',
  input: {
    folio: z.string().min(1).describe('Folio de la factura, p. ej. "F00167"'),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Detalle de factura',
    example: 'El detalle de la factura F00167, con su timbrado.',
  },
  handler: (input) => odooInvoiceDetail(callOdoo, input),
})
