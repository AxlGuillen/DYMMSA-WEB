import { defineTool } from '@/lib/mcp/core/define'
import { odooSaveProduct, saveProductShape } from '@/lib/mcp/tools/odoo/products-write'
import { odooWriteDeps } from '../shared'

// The view's button only: the authorization rides in the preview's _meta, never in the model's text.
export const odooSaveProductTool = defineTool({
  connector: 'odoo',
  name: 'odoo_save_product',
  kind: 'write',
  title: 'Alta de productos (Odoo)',
  description:
    'Solo la llama el botón de la vista de odoo_preview_quotation: da de alta en Odoo los productos nuevos de esa vista previa (bienes, IVA 16, factura por entrega). Sin la autorización de la vista no crea nada.',
  input: saveProductShape,
  annotations: { readOnlyHint: false, openWorldHint: false },
  adminOnly: true,
  visibility: ['app'],
  docs: {
    module: 'Cotizar y facturar',
    title: 'Alta de productos en Odoo',
    example: '(Boton "Dar de alta" de la vista previa.)',
    limits: 'Solo desde el boton de la vista previa y solo bienes con IVA 16; nunca inventa la clave SAT ni duplica un producto.',
  },
  handler: (input, ctx) => odooSaveProduct(odooWriteDeps, ctx, input),
})
