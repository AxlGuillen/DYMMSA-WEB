import { defineTool } from '@/lib/mcp/core/define'
import { odooSaveQuotation, saveQuotationShape } from '@/lib/mcp/tools/odoo/quotations'
import { odooWriteDeps } from '../shared'

export const odooSaveQuotationTool = defineTool({
  connector: 'odoo',
  name: 'odoo_save_quotation',
  kind: 'write',
  title: 'Guardar cotización (Odoo)',
  description:
    'Escribe en Odoo lo que mostró odoo_preview_quotation, con los MISMOS datos y su `clave`: crea la cotización en BORRADOR (cliente + lineas) o la edita (folio + lineas). Confirmarla como venta es odoo_confirm_quotation. Nunca la envía al cliente, ni publica ni timbra. Repetir la misma llamada no duplica; si responde que no se sabe si guardó, espera y repite exactamente la misma.',
  input: saveQuotationShape,
  // An edit replaces or removes lines; the `origin` key makes a repeat a no-op (#155).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: true },
  adminOnly: true,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Guardar cotizacion en Odoo',
    example: 'Si, guardala. / Cambia el precio de la linea 3 de la S00915.',
    evals: ['Sí, guarda la cotización tal como la vimos.', 'Confirmo los cambios a la S00915.'],
    limits: 'Solo lo que mostro la vista previa: cotizacion en borrador o editarla. Nunca la confirma ni la envia al cliente, no publica, no timbra ni crea clientes.',
  },
  handler: (input, ctx) => odooSaveQuotation(odooWriteDeps, ctx, input),
})
