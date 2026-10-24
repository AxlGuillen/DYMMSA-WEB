import { defineTool } from '@/lib/mcp/core/define'
import { draftInvoiceShape, odooCreateDraftInvoice } from '@/lib/mcp/tools/odoo/draft-invoice'
import { odooWriteDeps } from '../shared'

export const odooCreateDraftInvoiceTool = defineTool({
  connector: 'odoo',
  name: 'odoo_create_draft_invoice',
  kind: 'write',
  title: 'Factura en borrador (Odoo)',
  description:
    'Factura COMPLETA en BORRADOR de una venta confirmada de Odoo (`folio`). Sin `confirmar` no escribe: devuelve el resumen (cliente, total y líneas a facturar, entrega, si ya hay borrador); muéstralo y, tras el sí, repite con confirmar: true. Revisa que lo de bienes ya se haya entregado (validado en Odoo) y que no tenga ya una factura en borrador. Sin anticipos ni facturas parciales. Nunca publica, timbra ni envía: eso se hace en Odoo.',
  input: draftInvoiceShape,
  // A draft takes no folio, and an existing draft comes back as ya_existia (#155).
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  adminOnly: true,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Factura en borrador en Odoo',
    example: 'Haz la factura de la S00912.',
    limits: 'Primero muestra el resumen y solo con tu si crea el borrador. Factura completa de una venta confirmada y entregada; nunca publica, timbra ni envia; sin anticipos ni parciales.',
  },
  handler: (input, ctx) => odooCreateDraftInvoice(odooWriteDeps, ctx, input),
})
