import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { setInventoryLocation } from '@/lib/mcp/tools/inventory'

export const setInventoryLocationTool = defineTool({
  connector: 'dymmsa',
  name: 'set_inventory_location',
  kind: 'write',
  title: 'Asignar ubicación en tienda',
  description:
    'Asigna o corrige la ubicación física (gaveta) de un producto YA inventariado. ESCRIBE: usa solo cuando el usuario pida registrar dónde quedó algo (p. ej. "el 6954 quedó en la gaveta B3"). Solo toca el metadato de ubicación — las cantidades de inventario NUNCA se modifican por aquí. location vacío o ausente = borrar la ubicación.',
  input: {
    model_code: z.string().min(1).describe('Código del producto en inventario (match exacto, sin distinguir mayúsculas/minúsculas)'),
    location: z.string().optional().describe('Ubicación física/gaveta, texto libre; omite o vacío para borrarla'),
  },
  // Scoped write (#72, ADR-015): durable metadata, not transactional.
  annotations: { readOnlyHint: false, openWorldHint: false },
  docs: {
    module: 'Inventario',
    title: 'Asignar ubicacion en tienda',
    example: 'El 6954 quedo en la gaveta B3.',
    limits: 'Solo la gaveta de un producto ya inventariado. Nunca toca cantidades.',
  },
  handler: (input, { db }) => setInventoryLocation(db, input),
})
