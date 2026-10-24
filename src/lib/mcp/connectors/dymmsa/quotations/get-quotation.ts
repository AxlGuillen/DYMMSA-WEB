import { z } from 'zod'
import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getQuotation } from '@/lib/mcp/tools/quotations'

export const getQuotationTool = defineTool({
  connector: 'dymmsa',
  name: 'get_quotation',
  kind: 'read',
  title: 'Detalle de cotización',
  description:
    'Cotización completa con sus ítems (en orden), totales calculados (total y total de aprobados), estado de aprobación por ítem y la orden en que se convirtió (orden: null si no tiene). Obtén el id con list_quotations.',
  input: { id: z.string().describe('UUID de la cotización') },
  hints: dymmsaRead,
  docs: {
    module: 'Cotizaciones',
    title: 'Detalle de cotizacion',
    example: '¿Que aprobo el cliente de la cotizacion de Andritz y ya tiene orden?',
  },
  handler: ({ id }, { db }) => getQuotation(db, id),
})
