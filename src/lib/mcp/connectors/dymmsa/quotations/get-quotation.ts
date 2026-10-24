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
    'Una cotización con todas sus líneas numeradas (`linea`, secciones incluidas), totales en vivo (total y de aprobadas), aprobación por línea, `version` y la orden en que se convirtió (`orden`: null si no tiene). Acepta nombre, cliente o ref.',
  input: { cotizacion: z.string().min(1).describe('Nombre o cliente (parcial), ref o UUID') },
  hints: dymmsaRead,
  docs: {
    module: 'Cotizaciones',
    title: 'Detalle de cotizacion',
    example: '¿Que aprobo el cliente de la cotizacion de Andritz y ya tiene orden?',
  },
  handler: ({ cotizacion }, { db }) => getQuotation(db, cotizacion),
})
