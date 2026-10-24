import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination, readOnly } from '@/lib/mcp/core/schema'
import { listOrders } from '@/lib/mcp/tools/orders'

export const listOrdersTool = defineTool({
  connector: 'dymmsa',
  name: 'list_orders',
  kind: 'read',
  title: 'Listar órdenes',
  description:
    'Lista órdenes de compra con filtros. status: ordered | received | delivered | completed | cancelled. Úsala para "¿qué órdenes siguen abiertas?" o buscar por cliente. Nota: total_amount aquí es el monto SELLADO en la fila; usa get_order para el total recalculado en vivo desde los ítems.',
  input: {
    status: z.string().optional().describe('Filtrar por estado exacto'),
    search: z.string().optional().describe('Busca en nombre de orden y nombre del cliente'),
    ...pagination,
  },
  annotations: readOnly,
  docs: {
    module: 'Ordenes',
    title: 'Listar ordenes',
    example: '¿Que ordenes siguen abiertas?',
  },
  handler: (input, { db }) => listOrders(db, input),
})
