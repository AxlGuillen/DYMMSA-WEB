import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { URREA_STATUS_TOKENS } from '@/lib/order-status'
import { commitSaveOrderReception, planSaveOrderReception } from '@/lib/mcp/tools/orders-write'

export const saveOrderReceptionTool = defineTool({
  connector: 'dymmsa',
  name: 'save_order_reception',
  kind: 'write',
  title: 'Registrar recepción',
  description:
    'Registra lo recibido de URREA en una orden: por línea, `codigo` (o `linea` si se repite) y `recibido` total. Recibir lo pedido la marca surtida; el excedente entra al inventario. Pide el sí con la clave y muestra el excedente y el total de entrega.',
  input: {
    orden: z.string().min(1).describe('Nombre, cliente o ref'),
    lineas: z
      .array(
        z.strictObject({
          codigo: z.string().optional(),
          linea: z.number().int().min(1).max(9999).optional(),
          recibido: z.number().int().min(0).max(99999),
          estado: z.enum(URREA_STATUS_TOKENS.tokens).optional(),
        }),
      )
      .min(1)
      .max(200),
  },
  // Re-confirming the same quantities is a no-op by design (ADR-019): E(1,1).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  docs: {
    module: 'Ordenes',
    title: 'Registrar recepción',
    example: 'En la orden 12 llegaron 10 del código 6954.',
    evals: ['En la orden 12 llegaron 10 del código 6954.', 'Recibí completa la orden de Andritz.'],
    limits: 'Cantidades recibidas de una orden abierta. El excedente sobre lo pedido entra al inventario y nunca se factura. Cantidades de inventario sueltas son save_inventory_item.',
  },
  plan: (input, { db }) => planSaveOrderReception(db, input),
  commit: (_input, { db }, plan) => commitSaveOrderReception(db, plan),
})
