import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooSaleDetail } from '@/lib/mcp/tools/odoo/documents'

export const odooSaleDetailTool = defineTool({
  connector: 'odoo',
  name: 'odoo_sale_detail',
  kind: 'read',
  title: 'Detalle de venta (Odoo)',
  description:
    'Una orden de venta de Odoo (externo) completa por folio (p. ej. "S00247"): encabezado con estado y vendedor, las FACTURAS ligadas (folio, estado, pagada o no) y sus líneas con cantidades PEDIDO/ENTREGADO/FACTURADO/POR FACTURAR y unidad por producto — útil para "¿ya se entregó todo lo de la venta X?" o "¿qué falta por facturar?" (por_facturar > 0 distingue "falta facturar" de "no queda nada"). Acepta folio parcial.',
  input: {
    folio: z.string().min(1).describe('Folio de la orden de venta, p. ej. "S00247"'),
  },
  annotations: readOnly,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Detalle de venta',
    example: '¿Ya se entrego y facturo todo lo de la venta S00247?',
  },
  handler: (input) => odooSaleDetail(callOdoo, input),
})
