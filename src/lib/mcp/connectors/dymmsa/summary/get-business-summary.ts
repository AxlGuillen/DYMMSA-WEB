import { defineTool } from '@/lib/mcp/core/define'
import { dymmsaRead } from '../shared'
import { getBusinessSummary } from '@/lib/mcp/tools/summary'

export const getBusinessSummaryTool = defineTool({
  connector: 'dymmsa',
  name: 'get_business_summary',
  kind: 'read',
  title: 'Resumen del negocio',
  description:
    'Panorama general de DYMMSA en una llamada: cotizaciones por estado, órdenes por estado, salud del inventario, tamaño de catálogos y tareas abiertas. Úsala para "¿cómo vamos?".',
  input: {},
  hints: dymmsaRead,
  docs: {
    module: 'Panorama',
    title: 'Resumen del negocio',
    example: '¿Como vamos? Dame el panorama general.',
    evals: ['¿Cómo vamos? Dame el panorama del negocio.', '¿Cuántas cotizaciones esperan aprobación y cuántas órdenes siguen abiertas?'],
  },
  handler: (_input, { db }) => getBusinessSummary(db),
})
