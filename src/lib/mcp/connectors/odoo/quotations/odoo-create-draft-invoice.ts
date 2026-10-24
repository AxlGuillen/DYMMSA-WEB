import { defineTool } from '@/lib/mcp/core/define'
import { draftInvoiceShape, odooCreateDraftInvoice } from '@/lib/mcp/tools/odoo/draft-invoice'
import { odooWriteDeps } from '../shared'

export const odooCreateDraftInvoiceTool = defineTool({
  connector: 'odoo',
  name: 'odoo_create_draft_invoice',
  kind: 'write',
  title: 'Factura en borrador (Odoo)',
  description:
    'Crea la factura COMPLETA en BORRADOR de una venta confirmada de Odoo (`folio`), tras decir cuál y recibir el sí. Antes revisa que lo de bienes ya se haya entregado (validado en Odoo) y que no tenga ya una factura en borrador. Sin anticipos ni facturas parciales. Nunca publica, timbra ni envía: eso se hace en Odoo.',
  input: draftInvoiceShape,
  // A draft takes no folio, and an existing draft comes back as ya_existe (#155).
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
  adminOnly: true,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Factura en borrador en Odoo',
    example: 'Haz la factura de la S00912.',
    limits: 'Factura completa en borrador de una venta confirmada y entregada. Nunca publica, timbra ni envia; sin anticipos ni parciales.',
  },
  handler: (input, ctx) => odooCreateDraftInvoice(odooWriteDeps, ctx, input),
})
