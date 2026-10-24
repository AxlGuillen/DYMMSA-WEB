import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { createPayable } from '@/lib/mcp/tools/payables'

export const createPayableTool = defineTool({
  connector: 'dymmsa',
  name: 'create_payable',
  kind: 'write',
  title: 'Registrar factura por pagar',
  description:
    'Registra una factura de GASTO como pendiente: proveedor (nombre parcial; si no existe, dalo de alta con save_supplier), concepto, monto, fecha de factura y vencimiento opcional — sin él se calcula con los días de crédito del proveedor, como en la app. ESCRIBE: usa solo cuando el usuario pida registrar una factura; confirma los datos antes. Con varios proveedores coincidentes devuelve la lista para precisar.',
  input: {
    proveedor: z.string().min(1).describe('Nombre (o parte) del proveedor'),
    concepto: z.string().min(1).describe('Concepto de la factura'),
    monto: z.number().positive().describe('Mayor a 0'),
    moneda: z.enum(['MXN', 'USD']).optional().describe('Default MXN'),
    fecha_factura: z.string().describe('Fecha de la factura, YYYY-MM-DD'),
    vencimiento: z.string().optional().describe('Vencimiento, YYYY-MM-DD (default: fecha + plazo del proveedor)'),
    notas: z.string().optional().describe('Notas'),
  },
  // Scoped write (#109, ADR-030): always born pending; paying it is mark_payable_paid.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Finanzas',
    title: 'Registrar factura por pagar',
    example: 'Registra una factura de Tornillos MX por $2,500 con fecha de hoy.',
    limits: 'Nace pendiente; el vencimiento sale del plazo del proveedor, como en la app. Moneda MXN por default o USD; nunca se convierte.',
  },
  handler: (input, { db }) => createPayable(db, input),
})
