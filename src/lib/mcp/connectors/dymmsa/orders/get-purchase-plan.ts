import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getPurchasePlan } from '@/lib/mcp/tools/purchase'

export const getPurchasePlanTool = defineTool({
  connector: 'dymmsa',
  name: 'get_purchase_plan',
  kind: 'read',
  title: 'Planificador de compra de una orden',
  description:
    'Qué va a mayoreo (URREA, por paquetes STD) y qué a menudeo en una orden: por grupo código+marca la matemática (paquetes completos, resto, dinero parado), la recomendación al vuelo y la decisión guardada (con aviso si quedó desactualizada). "revisar" = el usuario debe decidir. Acepta id o nombre parcial de la orden/cliente.',
  input: { orden: z.string().min(1).describe('UUID, nombre de la orden o nombre del cliente (parcial)') },
  annotations: readOnly,
  docs: {
    module: 'Ordenes',
    title: 'Planificador de compra',
    example: '¿Que va a mayoreo y que a menudeo en la orden 12?',
  },
  handler: (input, { db }) => getPurchasePlan(db, input),
})
