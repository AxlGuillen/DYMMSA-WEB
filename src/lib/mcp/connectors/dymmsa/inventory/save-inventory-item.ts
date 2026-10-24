import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { commitSaveInventoryItem, planSaveInventoryItem } from '@/lib/mcp/tools/inventory'

export const saveInventoryItemTool = defineTool({
  connector: 'dymmsa',
  name: 'save_inventory_item',
  kind: 'write',
  title: 'Guardar inventario',
  description:
    'Asigna o corrige la ubicación física (gaveta) de productos YA inventariados: `productos` = [{ codigo, ubicacion }], hasta 30. Úsala para "el 6954 quedó en la gaveta B3". `ubicacion: ""` borra la gaveta; un código que no esté en el inventario o que coincida con varios frena toda la llamada. Directo. Solo toca la gaveta: las cantidades NUNCA se modifican por aquí.',
  input: {
    productos: z
      .array(
        z.strictObject({
          codigo: z.string().min(1).describe('Código del producto en inventario (sin distinguir mayúsculas)'),
          ubicacion: z.string().describe('Gaveta, texto libre; "" la borra'),
        }),
      )
      .min(1)
      .max(30),
  },
  // Replaces set_inventory_location (#155 C6). Durable metadata with absolute values: overwriting or clearing a
  // drawer is destructive, repeating it changes nothing. Phase D adds quantities and flips idempotence (ajuste).
  hints: { destructiveHint: true, idempotentHint: true, openWorldHint: false },
  docs: {
    module: 'Inventario',
    title: 'Guardar inventario',
    example: 'El 6954 quedo en la gaveta B3.',
    limits: 'Solo la gaveta de productos ya inventariados. Nunca toca cantidades.',
  },
  handler: async (input, { db }) => commitSaveInventoryItem(db, await planSaveInventoryItem(db, input)),
})
