import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoDate } from '@/lib/mcp/core/schema'
import { PAYABLE_CURRENCIES, PAYABLE_STATUS_TOKENS } from '@/lib/payables'
import { commitSavePayable, planSavePayable } from '@/lib/mcp/tools/payables-write'

export const savePayableTool = defineTool({
  connector: 'dymmsa',
  name: 'save_payable',
  kind: 'write',
  title: 'Guardar factura por pagar',
  description:
    'Alta o cambio de una factura de GASTO de la app (no de Odoo). Sin `factura` la registra (nace pendiente; vence en fecha + plazo del proveedor). Con `factura` (ref, concepto o proveedor) la corrige, la paga con su fecha real (`estado: pagada`, `fecha_pago` default hoy), la regresa a pendiente o la cancela. Úsala para "ya pagué la de Perfiles" o "la de Tornillos era por 3,200". Directo; solo cambiar cifras o fechas de una PAGADA pide el sí con la clave. Nunca convierte moneda; no borra (delete_record) ni reactiva una cancelada.',
  input: {
    factura: z.string().optional().describe('La existente: ref, concepto o proveedor; omítela para dar de alta'),
    proveedor: z.string().optional().describe('Nombre (o parte); en una existente, el nuevo'),
    concepto: z.string().optional(),
    monto: z.number().positive().optional().describe('Mayor a 0'),
    moneda: z.enum(PAYABLE_CURRENCIES).optional().describe('Default MXN'),
    fecha_factura: isoDate.optional(),
    vencimiento: isoDate.optional().describe('Default: fecha + plazo del proveedor'),
    notas: z.string().optional().describe('Texto vacío las borra'),
    estado: z.enum(PAYABLE_STATUS_TOKENS.tokens).optional(),
    fecha_pago: isoDate.optional().describe('Fecha REAL de pago (default hoy)'),
  },
  // Replaces create_payable, update_payable and mark_payable_paid (#155 C6). It edits with absolute values but a
  // repeated registration is a second invoice, so it is not idempotent (Auditoría DYMMSA-WEB §3: E(1,0)).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Finanzas',
    title: 'Guardar factura por pagar',
    example: 'Registra una factura de Tornillos MX por $2,500 / Ya pague la de Perfiles / La de Tornillos era por $3,200.',
    evals: ['Registra la de Tornillos MX por $800, ya la pagué hoy.', 'Ya pagué la de Perfiles, fue ayer.'],
    limits: 'Registra, corrige, paga, regresa a pendiente o cancela. Cambiar cifras o fechas de una pagada pide tu confirmación. Moneda MXN o USD, nunca se convierte; no borra ni reactiva una cancelada.',
  },
  plan: (input, { db }) => planSavePayable(db, input),
  commit: (_input, { db }, plan) => commitSavePayable(db, plan),
})
