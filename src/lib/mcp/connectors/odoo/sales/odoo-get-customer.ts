import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { odooGetCustomer, STATEMENT_INCLUDE } from '@/lib/mcp/tools/odoo/customers'
import { odooRead } from '../shared'

export const odooGetCustomerTool = defineTool({
  connector: 'odoo',
  name: 'odoo_get_customer',
  kind: 'read',
  title: 'Cliente y estado de cuenta (Odoo)',
  description:
    'Expediente de UN cliente de Odoo por nombre, RFC o #id (gana la coincidencia exacta; ninguna o varias = error con las opciones): contacto, ESTADO DE CUENTA bruto por factura según la fecha de VENCIMIENTO (`vence_desde`/`vence_hasta`; sin fechas ni `incluir` = todo lo vencido + lo que vence este mes, como la pantalla Clientes), notas de crédito aparte sin restar, `cartera_contable` (saldo neto de Odoo y días promedio de pago: no se cuadra contra lo bruto), ventas y facturación. Para toda la cartera, odoo_list_receivables.',
  input: {
    cliente: z.string().min(1).describe('Nombre, RFC o #id, p. ej. "Andritz" o "#24"'),
    vence_desde: isoDate.optional(),
    vence_hasta: isoDate.optional(),
    incluir: z.enum(STATEMENT_INCLUDE).optional().describe('Default ambas'),
  },
  hints: odooRead,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Cliente y estado de cuenta',
    example: 'Estado de cuenta de Andritz: lo vencido y lo que vence este mes.',
  },
  handler: (input) => odooGetCustomer(callOdoo, input),
})
