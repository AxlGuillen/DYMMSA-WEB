import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { pagination } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { searchProducts } from '@/lib/mcp/tools/products'

export const searchProductsTool = defineTool({
  connector: 'dymmsa',
  name: 'search_products',
  kind: 'read',
  title: 'Buscar productos ETM',
  description:
    'Busca en el catálogo ETM por ETM, código o descripción. Devuelve precio, marca, `se_vende` (sin_definir, si, no) y la Descripción DYMMSA ya resuelta con la jerarquía de catálogo.',
  input: {
    buscar: z.string().describe('Texto a buscar (ETM, código o descripción)'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Catalogos',
    title: 'Buscar productos ETM',
    example: 'Busca el ETM del rodillo de 9 pulgadas.',
    evals: ['Busca el ETM del rodillo de 9 pulgadas.', '¿Cuánto cuesta el ETM 1180234 y si lo vendemos?'],
  },
  handler: (input, { db }) => searchProducts(db, input),
})
