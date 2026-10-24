import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { searchUrreaCatalog } from '@/lib/mcp/tools/urrea'

export const searchUrreaCatalogTool = defineTool({
  connector: 'dymmsa',
  name: 'search_urrea_catalog',
  kind: 'read',
  title: 'Consultar catálogo URREA',
  description:
    'Consulta el catálogo oficial URREA por código (match exacto, normalizado) o por descripción (parcial, máx 20). Devuelve código, descripción oficial y std (unidades por paquete).',
  input: { query: z.string().describe('Código URREA o texto de la descripción') },
  hints: dymmsaRead,
  docs: {
    module: 'Catalogos',
    title: 'Consultar catalogo URREA',
    example: '¿Cuantas piezas trae el paquete del 6954?',
  },
  handler: ({ query }, { db }) => searchUrreaCatalog(db, query),
})
