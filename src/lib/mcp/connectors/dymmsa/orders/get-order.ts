import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getOrder } from '@/lib/mcp/tools/orders'

export const getOrderTool = defineTool({
  connector: 'dymmsa',
  name: 'get_order',
  kind: 'read',
  title: 'Detalle de orden',
  description:
    'Una orden con todas sus líneas numeradas (`linea`): cantidades (aprobada, en stock, por pedir, recibida), estado con URREA, ubicación en tienda, `version` y cuántas siguen pendientes con URREA. Acepta nombre, cliente o ref.',
  input: { orden: z.string().min(1).describe('Nombre o cliente (parcial), ref o UUID') },
  hints: dymmsaRead,
  docs: {
    module: 'Ordenes',
    title: 'Detalle de orden',
    example: '¿Que falta por recibir de URREA en la orden 12?',
    evals: ['¿Qué falta por recibir de URREA en la orden 12?', '¿Qué líneas de la orden de GE salen del stock?'],
  },
  handler: ({ orden }, { db }) => getOrder(db, orden),
})
