import { z } from 'zod'
import { callOdoo } from '@/lib/odoo/client'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { odooCustomerProfile } from '@/lib/mcp/tools/odoo/sales'

export const odooCustomerProfileTool = defineTool({
  connector: 'odoo',
  name: 'odoo_customer_profile',
  kind: 'read',
  title: 'Perfil de cliente (Odoo)',
  description:
    'El expediente completo de un cliente en Odoo (externo) en una llamada: datos de contacto (incl. RFC), su CARTERA como la calcula Odoo (deuda total, vencido y días promedio que tarda en pagar — DSO; saldo contable NETO de notas de crédito, no se cuadra contra la facturación bruta), ventas por estado, facturación con pendiente de pago, sus facturas vencidas con días de atraso y sus notas de crédito abiertas a hoy (`notas_credito_sin_aplicar`: saldo a favor exacto + las últimas 10, no restado de lo pendiente). Busca por nombre parcial; si hay varias coincidencias devuelve la lista para precisar.',
  input: {
    cliente: z.string().min(1).describe('Nombre (o parte) del cliente, p. ej. "GE" o "Andritz"'),
  },
  annotations: readOnly,
  docs: {
    module: 'Ventas y cobranza',
    title: 'Perfil de cliente',
    example: 'El expediente completo de FieldCore.',
  },
  handler: (input) => odooCustomerProfile(callOdoo, input),
})
