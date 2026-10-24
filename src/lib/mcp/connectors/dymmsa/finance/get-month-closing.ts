import { defineTool } from '@/lib/mcp/core/define'
import { isoMonth } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { getMonthClosing } from '@/lib/mcp/tools/finance'

export const getMonthClosingTool = defineTool({
  connector: 'dymmsa',
  name: 'get_month_closing',
  kind: 'read',
  title: 'Cierre del mes',
  description:
    'Cómo cierra un mes: egresos de la app (pagado, pendiente del mes, vencido arrastrado) + ingresos leídos de Odoo (cobrado, por cobrar, vencido por cobrar, notas de crédito aparte) y el cierre real/proyectado. Si Odoo no está disponible lo dice y el cierre refleja solo egresos. mes = YYYY-MM (default actual).',
  input: { mes: isoMonth.optional().describe('Default el actual') },
  hints: dymmsaRead,
  docs: {
    module: 'Finanzas',
    title: 'Cierre del mes',
    example: '¿Como cierra el mes?',
  },
  handler: (input, { db }) => getMonthClosing(db, input),
})
