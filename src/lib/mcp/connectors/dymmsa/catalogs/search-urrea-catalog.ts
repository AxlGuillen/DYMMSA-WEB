import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { searchUrreaCatalog } from '@/lib/mcp/tools/urrea'

export const searchUrreaCatalogTool = defineTool({
  connector: 'dymmsa',
  name: 'search_urrea_catalog',
  kind: 'read',
  title: 'Consultar catálogo URREA',
  description:
    'Consulta el catálogo oficial URREA por código (exacto, todas las marcas) o por descripción (parcial, paginada). Devuelve código, marca, descripción oficial y std (unidades por paquete).',
  input: { buscar: z.string().describe('Código URREA o texto de la descripción'), ...pagination },
  hints: dymmsaRead,
  docs: {
    module: 'Catalogos',
    title: 'Consultar catalogo URREA',
    example: '¿Cuantas piezas trae el paquete del 6954?',
    evals: ['¿Cuántas piezas trae el paquete del 6954?', 'Busca en el catálogo URREA algo de tijeras industriales.'],
  },
  handler: (input, { db }) => searchUrreaCatalog(db, input),
})
