import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { updatePayable } from '@/lib/mcp/tools/payables'

export const updatePayableTool = defineTool({
  connector: 'dymmsa',
  name: 'update_payable',
  kind: 'write',
  title: 'Corregir o cancelar factura por pagar',
  description:
    'Corrige una factura de gasto (concepto, monto, fechas, proveedor o notas) o la cancela con cancelar=true. Identifícala por id, concepto o proveedor; con varias coincidencias devuelve la lista. Pagarla o regresarla a pendiente es mark_payable_paid; borrarla o reactivar una cancelada, en la app. ESCRIBE: confirma antes qué factura y qué cambia.',
  input: {
    factura: z.string().min(1).describe('UUID, o parte del concepto / nombre del proveedor'),
    concepto: z.string().optional(),
    monto: z.number().positive().optional().describe('Mayor a 0'),
    moneda: z.enum(['MXN', 'USD']).optional(),
    fecha_factura: z.string().optional().describe('YYYY-MM-DD'),
    vencimiento: z.string().optional().describe('YYYY-MM-DD'),
    proveedor: z.string().optional().describe('Otro proveedor (nombre o parte)'),
    notas: z.string().optional().describe('Texto vacío las borra'),
    cancelar: z.boolean().optional().describe('true = cancelarla'),
  },
  // Scoped write (#134, ADR-037): same rules as the edit popup; deleting stays in the app.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Finanzas',
    title: 'Corregir o cancelar factura por pagar',
    example: 'La factura de Perfiles era por $3,200, no $2,300.',
    limits: 'Corrige concepto, monto, moneda (MXN o USD, sin convertir), fechas, proveedor o notas, o la cancela. No la paga, no la borra ni reactiva una cancelada.',
  },
  handler: (input, { db }) => updatePayable(db, input),
})
