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
    'Una cotización con todas sus líneas numeradas (`linea`, secciones incluidas), totales en vivo (total y de aprobadas), aprobación por línea, `version` y la orden en que se convirtió (`orden`: null si no tiene). Acepta nombre, cliente o ref. Un administrador recibe además `link_aprobacion` mientras está en revisión.',
  input: { cotizacion: z.string().min(1).describe('Nombre, cliente o ref') },
  hints: dymmsaRead,
  docs: {
    module: 'Cotizaciones',
    title: 'Detalle de cotizacion',
    example: '¿Que aprobo el cliente de la cotizacion de Andritz y ya tiene orden?',
    evals: ['¿Qué aprobó el cliente en la cotización de Andritz y ya tiene orden?', 'Dame la línea 4 de la cotización de GE con su precio.', 'Pásame el link de aprobación de la cotización de Truper.'],
  },
  handler: ({ cotizacion }, { db, role }) => getQuotation(db, cotizacion, { admin: role === 'admin' }),
})
