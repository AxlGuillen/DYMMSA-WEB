import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getPurchasePlan } from '@/lib/mcp/tools/purchase'

export const getPurchasePlanTool = defineTool({
  connector: 'dymmsa',
  name: 'get_purchase_plan',
  kind: 'read',
  title: 'Planificador de compra de una orden',
  description:
    'Qué va a mayoreo (URREA, por paquetes STD) y qué a menudeo en una orden: por grupo código+marca la matemática (paquetes completos, resto, dinero parado), la recomendación al vuelo y la decisión guardada (con aviso si quedó desactualizada). "revisar" = el usuario debe decidir. Acepta nombre, cliente o ref de la orden.',
  input: { orden: z.string().min(1).describe('Nombre, cliente o ref') },
  hints: dymmsaRead,
  docs: {
    module: 'Ordenes',
    title: 'Planificador de compra',
    example: '¿Que va a mayoreo y que a menudeo en la orden 12?',
    evals: ['¿Qué va a mayoreo y qué a menudeo en la orden 12?', 'En la orden de GE, ¿qué grupos están por revisar?'],
  },
  handler: (input, { db }) => getPurchasePlan(db, input),
})
