import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getCutPlan } from '@/lib/mcp/tools/cutting'

export const getCutPlanTool = defineTool({
  connector: 'dymmsa',
  name: 'get_cut_plan',
  kind: 'read',
  title: 'Lista de corte de una orden',
  description:
    'Piezas de tubo y placa que se mandan a hacer para una orden (módulo de corte), agrupadas por diámetro/espesor con la necesidad neta (largo + margen por corte, en mm) y, por cada presentación del proveedor ya capturada, cuántas barras u hojas se necesitan. Úsala para "¿cuánto tubo necesito para la orden de X?". Acepta nombre, cliente o ref de la orden.',
  input: { orden: z.string().min(1).describe('Nombre o cliente (parcial), ref o UUID') },
  hints: dymmsaRead,
  docs: {
    module: 'Ordenes',
    title: 'Lista de corte de una orden',
    example: '¿Cuanto tubo necesito para la orden 12 y cuantas barras salen?',
  },
  handler: (input, { db }) => getCutPlan(db, input),
})
