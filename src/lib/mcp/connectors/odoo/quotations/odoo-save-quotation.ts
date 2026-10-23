import { defineTool } from '@/lib/mcp/core/define'
import { odooSaveQuotation, saveQuotationShape } from '@/lib/mcp/tools/odoo/quotations'
import { odooWriteDeps } from '../shared'

export const odooSaveQuotationTool = defineTool({
  connector: 'odoo',
  name: 'odoo_save_quotation',
  kind: 'write',
  title: 'Guardar cotización (Odoo)',
  description:
    'Escribe en Odoo lo que mostró odoo_preview_quotation, con los MISMOS datos y su `clave`: crea la cotización en BORRADOR, la edita (folio + lineas) o la confirma como venta (folio + confirmar: true, tras mostrar al_confirmar y recibir el sí). Nunca la envía al cliente, ni publica ni timbra. Repetir la misma llamada no duplica; si responde que no se sabe si guardó, espera y repite exactamente la misma.',
  input: saveQuotationShape,
  annotations: { readOnlyHint: false, openWorldHint: false },
  adminOnly: true,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Guardar cotizacion en Odoo',
    example: 'Si, guardala. / Confirma la S00912 como venta.',
    limits: 'Solo lo que mostro la vista previa: cotizacion en borrador, editarla o confirmarla como venta. Nunca la envia al cliente, no publica, no timbra ni crea clientes.',
  },
  handler: (input, ctx) => odooSaveQuotation(odooWriteDeps, ctx, input),
})
