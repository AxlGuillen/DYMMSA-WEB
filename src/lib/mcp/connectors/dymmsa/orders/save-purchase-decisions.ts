import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { PURCHASE_CHOICE_TOKENS } from '@/lib/purchase-plan'
import { commitSavePurchaseDecisions, planSavePurchaseDecisions } from '@/lib/mcp/tools/purchase-write'

export const savePurchaseDecisionsTool = defineTool({
  connector: 'dymmsa',
  name: 'save_purchase_decisions',
  kind: 'write',
  title: 'Guardar decisiones de compra',
  description:
    'Decide mayoreo (URREA, por paquetes), mixto o menudeo por grupo código+marca de una orden. Nunca recibe cantidades: el servidor calcula STD y necesidad. `aceptar_recomendaciones` llena con lo sugerido los grupos sin decisión; los «revisar» los decide el usuario con `decisiones`. Guarda siempre el conjunto completo y, si algún grupo queda sin decidir, no guarda. Úsala para "en la orden de GE acepta las recomendaciones". Dos fases siempre.',
  input: {
    orden: z.string().min(1).describe('Nombre, cliente o ref'),
    decisiones: z
      .array(z.strictObject({ codigo: z.string().min(1), marca: z.string().optional(), eleccion: z.enum(PURCHASE_CHOICE_TOKENS.tokens) }))
      .min(1)
      .max(300)
      .optional(),
    aceptar_recomendaciones: z.literal(true).optional().describe('Los grupos sin decisión toman la recomendación'),
  },
  // The same choices over the same plan write the same rows: a repeat changes nothing more.
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  docs: {
    module: 'Ordenes',
    title: 'Guardar decisiones de compra',
    example: 'En la orden de GE acepta las recomendaciones; las de revisar, a mayoreo.',
    evals: ['En la orden de GE acepta las recomendaciones; las de revisar, a mayoreo.', 'Del 6954 de la orden 12, mándalo todo a menudeo.'],
    limits: 'Solo la eleccion mayoreo, mixto o menudeo por grupo; nunca cantidades. Pide tu confirmacion y no guarda si queda un grupo sin decidir.',
  },
  plan: (input, { db }) => planSavePurchaseDecisions(db, input),
  commit: (_input, { db }, plan) => commitSavePurchaseDecisions(db, plan),
})
