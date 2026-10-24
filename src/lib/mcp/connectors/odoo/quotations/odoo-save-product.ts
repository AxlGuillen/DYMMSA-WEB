import { defineTool } from '@/lib/mcp/core/define'
import { odooSaveProduct, saveProductShape } from '@/lib/mcp/tools/odoo/products-write'
import { odooWriteDeps } from '../shared'

// The view's button only: the authorization rides in the preview's _meta, never in the model's text.
export const odooSaveProductTool = defineTool({
  connector: 'odoo',
  name: 'odoo_save_product',
  kind: 'write',
  title: 'Alta de productos y clave SAT (Odoo)',
  description:
    'Solo la llama el botón de la vista de odoo_preview_quotation: da de alta en Odoo los productos nuevos de esa vista previa (bienes, IVA 16, factura por entrega) o les pone la clave SAT elegida a los que no la tienen. Sin la autorización de la vista no escribe nada.',
  input: saveProductShape,
  // Creates or fills an empty key; an existing product or key comes back as ya_existian / ya_tenian (#155, #154).
  hints: { destructiveHint: false, idempotentHint: true, openWorldHint: true },
  adminOnly: true,
  visibility: ['app'],
  docs: {
    module: 'Cotizar y facturar',
    title: 'Alta de productos y clave SAT en Odoo',
    example: '(Botones "Dar de alta" y "Asignar clave SAT" de la vista previa.)',
    evals: ['Da de alta el producto nuevo con la categoría de pinturas en aerosol (botón de la vista).'],
    limits:
      'Solo desde el boton de la vista previa: da de alta bienes con IVA 16 o pone la clave SAT a un producto que no la tiene. Nunca inventa la clave, no pisa una que ya este en Odoo ni duplica un producto.',
  },
  handler: (input, ctx) => odooSaveProduct(odooWriteDeps, ctx, input),
})
