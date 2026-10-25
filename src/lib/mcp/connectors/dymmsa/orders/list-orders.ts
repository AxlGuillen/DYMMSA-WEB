import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { listOrders } from '@/lib/mcp/tools/orders'
import { ORDER_STATUS_TOKENS } from '@/lib/order-status'

export const listOrdersTool = defineTool({
  connector: 'dymmsa',
  name: 'list_orders',
  kind: 'read',
  title: 'Listar órdenes',
  description:
    'Lista órdenes de compra con filtros, de la más reciente a la más antigua. Úsala para "¿qué órdenes siguen abiertas?" o buscar por cliente. `total_sellado` es el monto guardado en la fila; get_order trae el total recalculado.',
  input: {
    estado: z.enum(ORDER_STATUS_TOKENS.tokens).optional().describe('Filtrar por estado exacto'),
    buscar: z.string().optional().describe('Busca en nombre de orden y nombre del cliente'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Ordenes',
    title: 'Listar ordenes',
    example: '¿Que ordenes siguen abiertas?',
    evals: ['¿Qué órdenes siguen abiertas?', 'Dame las órdenes de Truper.'],
  },
  handler: (input, { db }) => listOrders(db, input),
})
