import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { DOCUMENT_TYPES } from '@/lib/mcp/tools/odoo/documents'
import { odooGetDocument } from '@/lib/mcp/tools/odoo/get-document'
import { odooRead } from '../shared'

export const odooGetDocumentTool = defineTool({
  connector: 'odoo',
  name: 'odoo_get_document',
  kind: 'read',
  title: 'Documento por folio (Odoo)',
  description:
    'Un documento de Odoo completo por folio; el prefijo elige el tipo y `tipo` lo fuerza. S… = venta o cotización: estado, vendedor, facturas ligadas y líneas pedido/entregado/facturado/por facturar ("¿qué falta por facturar?"). PAY… = pago: su complemento de pago (REP) ante el SAT y las facturas que paga. El resto = factura o nota de crédito: montos, saldo, término de pago, notas al pie ("PEDIDO: …"), vínculo real con la venta, timbrado CFDI y líneas. Acepta un folio parcial si es único; sin coincidencia o con varias, error. La respuesta trae `tipo`.',
  input: {
    folio: z.string().min(1).describe('Folio, p. ej. "F00167", "S00247" o "PAY00068"'),
    tipo: z.enum(DOCUMENT_TYPES).optional().describe('Solo si el prefijo no lo dice: factura (también nota de crédito), venta o pago'),
  },
  hints: odooRead,
  docs: {
    module: 'Contabilidad',
    title: 'Documento por folio',
    example: '¿Ya se entrego y facturo todo lo de la S00247? / El detalle de la F00167 con su timbrado.',
    evals: ['¿Ya se entregó y facturó todo lo de la S00247?', 'Abre el pago PAY0123 y dime si tiene complemento.'],
  },
  handler: (input) => odooGetDocument(callOdoo, input),
})
