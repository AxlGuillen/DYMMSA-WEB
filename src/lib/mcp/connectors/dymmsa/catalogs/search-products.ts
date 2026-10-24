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
    'Busca en el catálogo ETM por código ETM, model_code o descripción. Devuelve precio, marca, is_sold (null=sin definir, false=no lo vendemos) y la Descripción DYMMSA ya resuelta con la jerarquía de catálogo.',
  input: {
    query: z.string().describe('Texto a buscar (ETM, model_code o descripción)'),
    ...pagination,
  },
  hints: dymmsaRead,
  docs: {
    module: 'Catalogos',
    title: 'Buscar productos ETM',
    example: 'Busca el ETM del rodillo de 9 pulgadas.',
  },
  handler: (input, { db }) => searchProducts(db, input),
})
