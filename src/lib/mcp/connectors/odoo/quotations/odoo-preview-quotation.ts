import { defineTool } from '@/lib/mcp/core/define'
import { odooPreviewQuotation, previewQuotationShape } from '@/lib/mcp/tools/odoo/quotations'
import { ODOO_QUOTATION_VIEW, odooRead, odooWriteDeps } from '../shared'

export const odooPreviewQuotationTool = defineTool({
  connector: 'odoo',
  name: 'odoo_preview_quotation',
  kind: 'read',
  title: 'Vista previa de cotización (Odoo)',
  description:
    'SOLO LEE: arma la vista previa de una cotización de Odoo y firma la `clave` que exigen odoo_save_quotation y odoo_confirm_quotation (vale 30 min). Crear: `cliente` (nombre, RFC o #id; nunca se crean clientes) + `lineas`, la lista COMPLETA: cada producto con codigo, etm o producto_id, cantidad y precio unitario sin IVA; nota/seccion para textos. Editar: `folio` + `lineas` (parte de lineas_como_entrada). Revisar o confirmar: solo `folio`. En Claude se ve como tabla; los productos que falten se dan de alta con su botón. Muestra el resumen (bloqueos, avisos, al_confirmar) y espera el sí antes de guardar.',
  input: previewQuotationShape,
  annotations: odooRead,
  adminOnly: true,
  view: ODOO_QUOTATION_VIEW,
  docs: {
    module: 'Cotizar y facturar',
    title: 'Vista previa de cotizacion',
    example: 'Haz esta cotizacion en Odoo para GE Power con estos 6 aerosoles a $56.03.',
  },
  handler: (input, ctx) => odooPreviewQuotation(odooWriteDeps, ctx, input),
})
