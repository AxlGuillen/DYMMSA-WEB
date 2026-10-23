import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooInvoiceLinkCheck } from '@/lib/mcp/tools/odoo/links'

export const odooInvoiceLinkCheckTool = defineTool({
  connector: 'odoo',
  name: 'odoo_invoice_link_check',
  kind: 'read',
  title: 'Facturas sin orden de venta (Odoo)',
  description:
    'Revisión de que cada factura de cliente contabilizada en Odoo esté ligada a su orden de venta, en una llamada: lee las facturas del periodo (default últimos 30 días; opcionalmente un cliente) y devuelve las HUÉRFANAS (sin orden ligada ni origen) y las de VÍNCULO ROTO (el origen menciona una orden pero ninguna está ligada), cada una con folio, cliente, fecha, total, origen, notas al pie ("PEDIDO: …") y término de pago. Usa el vínculo real (botón "Órdenes de venta"), no el texto del origen. Pensada para la revisión periódica.',
  input: {
    date_from: z.string().optional().describe('Desde (YYYY-MM-DD, sobre invoice_date); default hace 30 días'),
    date_to: z.string().optional().describe('Hasta (YYYY-MM-DD); default hoy'),
    cliente: z.string().optional().describe('Nombre (o parte) del cliente para acotar'),
    incluir_ligadas: z.boolean().optional().describe('true = también listar las facturas correctamente ligadas'),
  },
  annotations: readOnly,
  docs: {
    module: 'Contabilidad',
    title: 'Facturas sin orden de venta',
    example: '¿Que facturas del mes no estan ligadas a su orden de venta?',
  },
  handler: (input) => odooInvoiceLinkCheck(callOdoo, input),
})
