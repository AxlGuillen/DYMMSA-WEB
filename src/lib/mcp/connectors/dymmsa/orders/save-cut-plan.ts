import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveCutPlan, CUT_ACTIONS, planSaveCutPlan } from '@/lib/mcp/tools/cutting-write'

export const saveCutPlanTool = defineTool({
  connector: 'dymmsa',
  name: 'save_cut_plan',
  kind: 'write',
  title: 'Guardar lista de corte',
  description:
    'Agrega, quita o reemplaza piezas de la lista de corte de una orden, en mm (pulgadas ×25.4; confirma la conversión). Tubo: diametro_mm; placa: espesor_mm y ancho_mm. Agregar es directo; quitar (por número de get_cut_plan) y reemplazar piden el sí con la clave y dicen cómo cambia la necesidad neta. Úsala para "agrega cuatro tubos de 1 pulgada de 300 mm a la orden 12".',
  input: {
    orden: z.string().min(1).describe('Nombre, cliente o ref'),
    accion: z.enum(CUT_ACTIONS),
    piezas: z
      .array(
        z.strictObject({
          tipo: z.enum(['tubo', 'placa']),
          diametro_mm: z.number().positive().optional(),
          espesor_mm: z.number().positive().optional(),
          ancho_mm: z.number().positive().optional(),
          largo_mm: z.number().positive(),
          cantidad: z.number().int().min(1).max(99999),
          pedido_como: z.string().max(80).optional(),
        }),
      )
      .max(200)
      .optional(),
    quitar_piezas: z.array(z.number().int().min(1).max(9999)).max(200).optional(),
  },
  // Adding puts pieces on the end; removing or replacing overwrites the list: the audit's E(1,0) (Auditoría DYMMSA-WEB §3).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Ordenes',
    title: 'Guardar lista de corte',
    example: 'Agrega a la lista de corte de la orden 12 cuatro tubos de 1 pulgada de 300 mm.',
    evals: ['Agrega a la lista de corte de la orden 12 cuatro tubos de 1 pulgada de 300 mm.', 'Quita las placas de 6 mm de la lista de corte de la orden de Andritz.'],
    limits: 'Piezas de tubo y placa en mm de una orden abierta. Agregar es directo; quitar o reemplazar piden tu confirmacion. Las barras y hojas del proveedor son aparte.',
  },
  plan: (input, { db }) => planSaveCutPlan(db, input),
  commit: (_input, { db }, plan) => commitSaveCutPlan(db, plan),
})
