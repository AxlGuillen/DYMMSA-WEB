import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getOrder } from '@/lib/mcp/tools/orders'

export const getOrderTool = defineTool({
  connector: 'dymmsa',
  name: 'get_order',
  kind: 'read',
  title: 'Detalle de orden',
  description:
    'Orden completa con sus ítems: cantidades (aprobada/en stock/por pedir/recibida), urrea_status por ítem, ubicación en tienda y cuántos ítems siguen pendientes con URREA.',
  input: { id: z.string().describe('UUID de la orden') },
  annotations: readOnly,
  docs: {
    module: 'Ordenes',
    title: 'Detalle de orden',
    example: '¿Que falta por recibir de URREA en la orden 12?',
  },
  handler: ({ id }, { db }) => getOrder(db, id),
})
