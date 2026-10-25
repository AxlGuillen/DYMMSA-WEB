import { defineTool } from '@/lib/mcp/core/define'
import { isoMonth } from '@/lib/mcp/core/schema'
import { dymmsaRead } from '../shared'
import { getPayablesOverview } from '@/lib/mcp/tools/payables'

export const getPayablesOverviewTool = defineTool({
  connector: 'dymmsa',
  name: 'get_payables_overview',
  kind: 'read',
  title: 'Resumen de facturas por pagar del mes',
  description:
    'Responde "¿qué debo esta semana / este mes?": pendiente del mes por semana de vencimiento, vencido (incluye el arrastre de meses anteriores), por vencer en 7 días, pagado en el mes, y las próximas 15 facturas pendientes. mes = YYYY-MM (default: el actual).',
  input: { mes: isoMonth.optional().describe('Default el actual') },
  hints: dymmsaRead,
  docs: {
    module: 'Finanzas',
    title: 'Resumen de facturas por pagar',
    example: '¿Que debo esta semana?',
    evals: ['¿Qué debo esta semana?', '¿Cuánto tengo vencido?'],
  },
  handler: (input, { db }) => getPayablesOverview(db, input),
})
