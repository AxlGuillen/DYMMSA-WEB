import { defineTool } from '@/lib/mcp/core/define'
import { confirmQuotationShape, odooConfirmQuotation } from '@/lib/mcp/tools/odoo/quotations'
import { odooWriteDeps } from '../shared'

export const odooConfirmQuotationTool = defineTool({
  connector: 'odoo',
  name: 'odoo_confirm_quotation',
  kind: 'write',
  title: 'Confirmar cotización (Odoo)',
  description:
    'Confirma como VENTA la cotización de Odoo que revisó odoo_preview_quotation con solo el `folio`: el mismo folio y su `clave`, tras mostrar al_confirmar y recibir el sí. Odoo crea la entrega y la fecha pasa a hoy; deshacerlo solo se puede en Odoo. Nunca la envía al cliente ni factura. Si ya estaba confirmada lo dice sin escribir; si responde que no se sabe si quedó, repite la misma llamada.',
  input: confirmQuotationShape,
  // Confirming sets off Odoo's own effects (the delivery) that only Odoo undoes; a retry answers "ya estaba" (#155 B2b).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  adminOnly: true,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Confirmar cotizacion en Odoo',
    example: 'Confirma la S00912 como venta.',
    limits: 'Solo la cotizacion que mostro la revision de la vista previa, sin cambios desde entonces. Nunca la envia al cliente, no factura, no publica ni timbra; deshacerla es en Odoo.',
  },
  handler: (input, ctx) => odooConfirmQuotation(odooWriteDeps, ctx, input),
})
