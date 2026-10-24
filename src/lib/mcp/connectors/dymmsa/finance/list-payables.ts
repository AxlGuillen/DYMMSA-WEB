import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { isoMonth, pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { listPayables } from '@/lib/mcp/tools/payables'
import { PAYABLE_FILTER_TOKENS } from '@/lib/payables'

export const listPayablesTool = defineTool({
  connector: 'dymmsa',
  name: 'list_payables',
  kind: 'read',
  title: 'Facturas por pagar',
  description:
    'Facturas de GASTOS de la app (registro propio; Odoo solo factura a clientes) con proveedor, monto, vencimiento y días para vencer (negativo = vencida). Filtra por estado (vencida = pendientes ya vencidas), mes de VENCIMIENTO, proveedor (nombre parcial) o concepto. Ordenadas por vencimiento.',
  input: {
    estado: z.enum(PAYABLE_FILTER_TOKENS.tokens).optional(),
    mes: isoMonth.optional().describe('Mes de vencimiento'),
    proveedor: z.string().optional().describe('Nombre (o parte) del proveedor'),
    concepto: z.string().optional().describe('Texto del concepto (parcial)'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Finanzas',
    title: 'Facturas por pagar',
    example: '¿Que facturas vencen este mes?',
  },
  handler: (input, { db }) => listPayables(db, input),
})
