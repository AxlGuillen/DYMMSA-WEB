import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveInventoryItem, planSaveInventoryItem } from '@/lib/mcp/tools/inventory'

export const saveInventoryItemTool = defineTool({
  connector: 'dymmsa',
  name: 'save_inventory_item',
  kind: 'write',
  title: 'Guardar inventario',
  description:
    'Cambia el inventario de la TIENDA, hasta 30 productos: gaveta (`ubicacion`, "" la borra), conteo físico (`cantidad_contada`: se guarda menos lo que las órdenes abiertas tienen apartado) o delta (`ajuste`). Úsala para "conté el 6954: hay 12, gaveta B3". Solo la gaveta es directa; toda cantidad pide el sí con la clave y un `motivo` que queda en la bitácora. `crear: true` da de alta códigos nuevos. No borra ni importa.',
  input: {
    productos: z
      .array(
        z.strictObject({
          codigo: z.string().min(1),
          ubicacion: z.string().optional(),
          cantidad_contada: z.number().int().min(0).max(999999).optional(),
          ajuste: z.number().int().min(-999999).max(999999).optional(),
        }),
      )
      .min(1)
      .max(30),
    crear: z.literal(true).optional().describe('Permite códigos que aún no están'),
    motivo: z.string().max(200).optional().describe('Obligatorio con cantidades'),
  },
  // Replaces set_inventory_location (#155 C6). A drawer is absolute, but a delta (`ajuste`) repeated is applied twice: E(1,0).
  hints: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  adminOnly: true,
  confirm: 'two_phase',
  direct: true,
  docs: {
    module: 'Inventario',
    title: 'Guardar inventario',
    example: 'Conte el 6954: hay 12, y quedo en la gaveta B3.',
    evals: ['Conté el 6954: hay 12, y quedó en la gaveta B3.', 'Borra la gaveta del 4410.'],
    limits: 'Gaveta, conteo fisico (menos lo apartado en ordenes abiertas) y ajustes, con motivo en la bitacora. Solo la gaveta es directa. No borra ni importa archivos.',
  },
  plan: (input, { db }) => planSaveInventoryItem(db, input),
  commit: (_input, { db }, plan) => commitSaveInventoryItem(db, plan),
})
