import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { listPayables } from '@/lib/mcp/tools/payables'

export const listPayablesTool = defineTool({
  connector: 'dymmsa',
  name: 'list_payables',
  kind: 'read',
  title: 'Facturas por pagar',
  description:
    'Facturas de GASTOS de la app (registro propio; Odoo solo factura a clientes) con proveedor, monto, vencimiento y días para vencer (negativo = vencida). Filtra por estado (pending | overdue = pendientes ya vencidas | paid | cancelled), mes de VENCIMIENTO (YYYY-MM), proveedor (nombre parcial) o concepto. Ordenadas por vencimiento.',
  input: {
    estado: z.string().optional().describe('pending | overdue | paid | cancelled'),
    mes: z.string().optional().describe('Mes de vencimiento, YYYY-MM'),
    proveedor: z.string().optional().describe('Nombre (o parte) del proveedor'),
    concepto: z.string().optional().describe('Texto del concepto (parcial)'),
    limit: z.number().int().min(1).max(100).optional().describe('Máx facturas (default 50)'),
  },
  annotations: readOnly,
  docs: {
    module: 'Finanzas',
    title: 'Facturas por pagar',
    example: '¿Que facturas vencen este mes?',
  },
  handler: (input, { db }) => listPayables(db, input),
})
