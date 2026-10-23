import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { readOnly } from '@/lib/mcp/core/schema'
import { getPayable } from '@/lib/mcp/tools/payables'

export const getPayableTool = defineTool({
  connector: 'dymmsa',
  name: 'get_payable',
  kind: 'read',
  title: 'Detalle de factura por pagar',
  description:
    'Una factura de gasto completa: proveedor y su plazo, concepto, monto, fechas, estado y notas. Acepta id, o parte del concepto o del nombre del proveedor; con varias coincidencias devuelve la lista.',
  input: { factura: z.string().min(1).describe('UUID, o parte del concepto / nombre del proveedor') },
  annotations: readOnly,
  docs: {
    module: 'Finanzas',
    title: 'Detalle de factura por pagar',
    example: 'Dame el detalle de la factura de Perfiles.',
  },
  handler: ({ factura }, { db, userId }) => getPayable(db, userId, factura),
})
